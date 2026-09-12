"""The ASGI application.

Dependencies are built once in the lifespan and hung on ``app.state``, so a test can swap
any of them for a fake without patching a module. The extension router reads them from
there rather than importing singletons, which is what makes the frozen contract testable
without a network, a model or an image library.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Final

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from contentfirewall.adapters.imaging.fetch import GuardedImageFetcher
from contentfirewall.adapters.imaging.vips import VipsImageOps
from contentfirewall.adapters.model.gateway import HttpModelGateway
from contentfirewall.api.extension.policy import (
    dev_auth_bypass_enabled,
    make_dev_resolver,
    make_unconfigured_resolver,
)
from contentfirewall.api.extension.router import router as extension_router
from contentfirewall.db.session import create_engine, create_session_factory
from contentfirewall.services.extension_auth import make_database_resolver
from contentfirewall.settings import Settings
from contentfirewall.settings import settings as default_settings

logger: Final = logging.getLogger(__name__)

SECURITY_HEADERS: Final = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
}


def _policy_resolver(app: FastAPI, config: Settings, bypass: bool):
    """Pick how an extension request proves what it may ask for.

    Three states, and the third is the one worth being careful about:

    * **bypass** — development only, double-gated, synthesises a policy from the request.
    * **database** — the real ladder: token, access, ownership.
    * **neither** — refuse everything with 401. Answering without a policy would mean
      checking against nothing, which looks exactly like protection and is not.
    """
    if bypass:
        # Loud on purpose: this is the one setting that turns authentication off.
        logger.warning("extension auth bypass is ENABLED (CF_DEV_NO_AUTH=1, non-production)")
        return make_dev_resolver()

    if config.database_url and config.extension_token_secret:
        engine = create_engine(config.database_url)
        app.state.engine = engine
        app.state.sessions = create_session_factory(engine)
        return make_database_resolver(app.state.sessions, secret=config.extension_token_secret)

    missing = [
        name
        for name, value in (
            ("DATABASE_URL", config.database_url),
            ("CF_EXTENSION_TOKEN_SECRET/JWT_SECRET", config.extension_token_secret),
        )
        if not value
    ]
    logger.error("extension endpoints will refuse every request: %s unset", ", ".join(missing))
    return make_unconfigured_resolver()


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or default_settings

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        config.require_gateway()
        app.state.model = HttpModelGateway(base_url=config.gateway_url, api_key=config.gateway_key)
        app.state.fetcher = GuardedImageFetcher()
        # Constructed here so a missing libvips fails the *boot*, loudly, rather than
        # degrading every request into sending the model a URL instead of pixels — a
        # fallback that looks like success and leaves images uncovered.
        app.state.ops = VipsImageOps()
        try:
            yield
        finally:
            await app.state.model.aclose()
            await app.state.fetcher.aclose()
            app.state.ops.close()

    app = FastAPI(
        title="Content Firewall",
        lifespan=lifespan,
        docs_url=None if config.is_production else "/docs",
        redoc_url=None,
    )

    bypass = dev_auth_bypass_enabled()
    app.state.allow_private_network = not config.is_production
    app.state.resolve_policy = _policy_resolver(app, config, bypass)

    @app.middleware("http")
    async def security_headers(request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        return response

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> JSONResponse:
        """Liveness only. Never checks a dependency: a failing database must not cause an
        orchestrator to restart a process that is working."""
        return JSONResponse({"status": "ok"})

    app.include_router(extension_router)
    return app


app = create_app()
