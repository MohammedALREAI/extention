"""Configuration, read once and validated at import.

Deliberately strict about the gateway: an unset ``BUILT_IN_FORGE_API_URL`` used to surface
as a confusing failure on the first detection, minutes after boot and far from the cause.
``require_gateway()`` is called at startup so a misconfigured process refuses to start
rather than serving errors.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from dotenv import load_dotenv

# The repository root holds the .env shared with the Node server during the migration.
_REPO_ROOT: Final = Path(__file__).resolve().parents[3]
load_dotenv(_REPO_ROOT / ".env", override=False)


def _csv(name: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in os.getenv(name, "").split(",") if part.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    gateway_url: str = field(default_factory=lambda: os.getenv("BUILT_IN_FORGE_API_URL", "").rstrip("/"))
    gateway_key: str = field(default_factory=lambda: os.getenv("BUILT_IN_FORGE_API_KEY", ""))

    model_visual: tuple[str, ...] = field(default_factory=lambda: _csv("CF_MODEL_VISUAL"))
    model_semantic: tuple[str, ...] = field(default_factory=lambda: _csv("CF_MODEL_SEMANTIC"))
    model_moderation: tuple[str, ...] = field(default_factory=lambda: _csv("CF_MODEL_MODERATION"))

    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", "redis://localhost:6379/0"))

    # One secret currently signs both session cookies and extension tokens, so rotating
    # either invalidates the other — including every extension already installed, which
    # nobody can force-update. These allow the two trust boundaries to separate, defaulting
    # to the shared secret so tokens issued before the split keep verifying.
    session_secret: str = field(
        default_factory=lambda: os.getenv("CF_SESSION_SECRET") or os.getenv("JWT_SECRET", "")
    )
    extension_token_secret: str = field(
        default_factory=lambda: os.getenv("CF_EXTENSION_TOKEN_SECRET") or os.getenv("JWT_SECRET", "")
    )

    environment: str = field(default_factory=lambda: os.getenv("CF_ENV", os.getenv("NODE_ENV", "development")))

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def require_gateway(self) -> None:
        missing = [
            name
            for name, value in (
                ("BUILT_IN_FORGE_API_URL", self.gateway_url),
                ("BUILT_IN_FORGE_API_KEY", self.gateway_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"Model gateway is not configured: {', '.join(missing)} unset.")


settings: Final = Settings()
