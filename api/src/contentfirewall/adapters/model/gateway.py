"""The model gateway: one OpenAI-compatible HTTP client, with a route ladder in front.

A caller names a *route* ("visual"), never a model. The route decides which model ids to
try and in what order, so swapping a provider is configuration rather than a code change —
which is the whole reason the previous implementation could survive a provider outage by
editing an environment variable.

Two behaviours carried over deliberately from ``server/modelRouter.ts``:

* **the ladder is the retry**, not the HTTP client. Each attempt runs with retries disabled
  and its own short timeout, so a dead provider costs one timeout and moves on rather than
  burning the whole budget backing off against a host that is not coming back;
* **a parse failure counts as a model failure.** A model that reliably answers with
  unparseable JSON is as broken as one that times out, and the breaker should shun it.

The circuit breaker and catalog cache are per-process here. That is correct for one worker
and wrong for several — the shared Redis implementations replace them in Phase 6, behind
these same two small interfaces.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

import httpx

from contentfirewall.domain.errors import DomainError
from contentfirewall.domain.ports import ModelAnswer, ModelCall

CATALOG_TTL_S: Final = 5 * 60
CIRCUIT_FAILURE_LIMIT: Final = 2
CIRCUIT_COOLDOWN_S: Final = 60


@dataclass(frozen=True, slots=True)
class ModelRoute:
    preferred_prefixes: tuple[str, ...]
    max_attempts: int
    timeout_s: float


# Three attempts at 6s must all fit inside the extension's own 20s deadline, which is
# compiled into copies already installed in browsers. Raising either number here requires
# a matching change there — which cannot be made for existing installs.
MODEL_ROUTES: Final[dict[str, ModelRoute]] = {
    "semantic": ModelRoute(
        ("claude-haiku-4-5", "gemini-3-flash-preview", "gpt-5-mini", "gpt-4o-mini"), 2, 5.0
    ),
    "visual": ModelRoute(
        ("gemini-3.1-pro-preview", "gemini-3-flash-preview", "claude-sonnet-4-6", "gpt-4o", "gpt-5"), 3, 6.0
    ),
    "developer_moderation": ModelRoute(
        ("gpt-5-mini", "claude-haiku-4-5", "gemini-3-flash-preview", "gpt-4o-mini"), 2, 6.0
    ),
}

MODEL_ROUTE_ENV_VARS: Final[dict[str, str]] = {
    "semantic": "CF_MODEL_SEMANTIC",
    "visual": "CF_MODEL_VISUAL",
    "developer_moderation": "CF_MODEL_MODERATION",
}


def route_prefixes(route: str, env: Mapping[str, str] | None = None) -> tuple[str, ...]:
    """Configured prefixes for a route, falling back to the built-in preference order.

    Model names are provider-specific, so hardcoding them ties the app to one gateway:
    point it at a different provider and every route fails with "no eligible model" for a
    reason nothing explains. These variables let the names be set per route without
    touching code — and are how a provider outage gets worked around in minutes.
    """
    source = os.environ if env is None else env
    configured = tuple(
        part.strip() for part in source.get(MODEL_ROUTE_ENV_VARS[route], "").split(",") if part.strip()
    )
    return configured or MODEL_ROUTES[route].preferred_prefixes


class GatewayError(RuntimeError):
    """Every model for a route failed, or the catalog itself is unreachable."""


def matches_prefix(model_id: str, prefix: str) -> bool:
    """Match on the full id and on the part after the last slash.

    Some gateways namespace their catalog by vendor ("qwen/qwen3-vl-32b-instruct"), so a
    plain startswith on the family name would match nothing there.
    """
    return model_id.startswith(prefix) or model_id.rsplit("/", 1)[-1].startswith(prefix)


def ordered_models(available: Sequence[str], prefixes: Sequence[str]) -> list[str]:
    """Resolve prefixes to concrete ids, in preference order, without duplicates.

    Two prefixes can resolve to the same model; the route needs two distinct attempts, not
    the same one retried.
    """
    ordered: list[str] = []
    for prefix in prefixes:
        match = next((model for model in available if matches_prefix(model, prefix)), None)
        if match is not None and match not in ordered:
            ordered.append(match)
    return ordered


@dataclass
class CircuitBreaker:
    """Per-model failure counter. Two consecutive failures shun a model for a minute."""

    now: Callable[[], float] = time.monotonic
    _state: dict[str, tuple[int, float]] = field(default_factory=dict)

    def is_open(self, model: str) -> bool:
        return self._state.get(model, (0, 0.0))[1] > self.now()

    def record_success(self, model: str) -> None:
        self._state.pop(model, None)  # a success resets the count entirely

    def record_failure(self, model: str) -> None:
        failures = self._state.get(model, (0, 0.0))[0] + 1
        open_until = self.now() + CIRCUIT_COOLDOWN_S if failures >= CIRCUIT_FAILURE_LIMIT else 0.0
        self._state[model] = (failures, open_until)


class HttpModelGateway:
    """Satisfies the domain's ``ModelGateway`` protocol against an OpenAI-compatible API."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        client: httpx.AsyncClient | None = None,
        prefixes_for: Callable[[str], Sequence[str]] | None = None,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        # One pooled client for the process. The previous implementation used a bare
        # fetch() per call, paying a fresh TLS handshake every time.
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(connect=2.0, read=30.0, write=2.0, pool=1.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=50),
        )
        self._prefixes_for = prefixes_for or route_prefixes
        self._now = now
        self._breaker = CircuitBreaker(now=now)
        self._catalog: tuple[list[str], float] | None = None
        self._catalog_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    @property
    def headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self._api_key}", "content-type": "application/json"}

    async def catalog(self) -> list[str]:
        """Model ids the gateway offers, cached for five minutes."""
        if self._catalog is not None and self._catalog[1] > self._now():
            return self._catalog[0]
        async with self._catalog_lock:
            if self._catalog is not None and self._catalog[1] > self._now():
                return self._catalog[0]
            try:
                response = await self._client.get(f"{self._base_url}/v1/models", headers=self.headers)
                response.raise_for_status()
                models = [str(entry["id"]) for entry in response.json().get("data", []) if "id" in entry]
            except (httpx.HTTPError, ValueError, KeyError) as error:
                # Naming the variables to check is the difference between a dead end and a
                # one-line fix; this is by far the most common cause.
                raise GatewayError(
                    "No model catalog is available. Check BUILT_IN_FORGE_API_URL and "
                    f"BUILT_IN_FORGE_API_KEY. ({error})"
                ) from error
            self._catalog = (models, self._now() + CATALOG_TTL_S)
            return models

    async def models_for(self, route: str) -> list[str]:
        return ordered_models(await self.catalog(), self._prefixes_for(route))

    def _payload(self, call: ModelCall, model: str) -> dict[str, Any]:
        # A text-only message goes as a plain string, not a one-element parts array. Both
        # are valid OpenAI-compatible shapes, but providers do not treat them alike — one
        # returned empty content for the array form, which surfaced as an unparseable
        # reply rather than as anything naming the real cause.
        content: str | list[dict[str, Any]]
        if call.images:
            content = [{"type": "text", "text": call.prompt}]
            content.extend(
                {"type": "image_url", "image_url": {"url": image.url, "detail": image.detail}}
                for image in call.images
            )
        else:
            content = call.prompt

        messages: list[dict[str, Any]] = []
        if call.system_prompt:
            messages.append({"role": "system", "content": call.system_prompt})
        messages.append({"role": "user", "content": content})

        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": call.max_tokens,
            "messages": messages,
        }
        if call.response_schema is not None:
            # A strict schema is enforced upstream, so a malformed answer never reaches the
            # parser — cheaper and more reliable than catching it afterwards.
            payload["response_format"] = {"type": "json_schema", "json_schema": dict(call.response_schema)}
        elif call.json_object:
            payload["response_format"] = {"type": "json_object"}
        return payload

    async def invoke(self, call: ModelCall, *, timeout: float | None = None) -> ModelAnswer:  # noqa: ASYNC109
        route = MODEL_ROUTES[call.route]
        candidates = await self.models_for(call.route)
        if not candidates:
            available = ", ".join((await self.catalog())[:10]) or "none"
            raise GatewayError(
                f'No model matches route "{call.route}". Looked for ids starting with: '
                f"{', '.join(self._prefixes_for(call.route))}. Set "
                f"{MODEL_ROUTE_ENV_VARS[call.route]} to names your provider offers. Available: {available}"
            )

        eligible = [model for model in candidates if not self._breaker.is_open(model)][: route.max_attempts]
        if not eligible:
            raise GatewayError(f'Every model for route "{call.route}" is in cooldown after repeated failures.')

        last_error: Exception | None = None
        for attempt, model in enumerate(eligible, start=1):
            # Each attempt gets the route's own timeout, bounded by whatever the caller's
            # overall budget has left. A ladder that ignores the budget answers after the
            # client has already given up.
            step = route.timeout_s if timeout is None else min(route.timeout_s, max(0.0, timeout))
            if step <= 0:
                break
            try:
                response = await self._client.post(
                    f"{self._base_url}/v1/chat/completions",
                    headers=self.headers,
                    json=self._payload(call, model),
                    timeout=step,
                )
                response.raise_for_status()
                body = response.json()
                content = body["choices"][0]["message"]["content"]
                # Inside the try on purpose: a model that returns empty or malformed
                # content has failed, and the ladder must move to the next one rather than
                # hand the caller something it cannot use.
                value = call.parse(content) if call.parse is not None else None
            except (httpx.HTTPError, KeyError, IndexError, ValueError, DomainError) as error:
                last_error = error
                self._breaker.record_failure(model)
                continue

            self._breaker.record_success(model)
            return ModelAnswer(content=content, model=model, attempts=attempt, value=value)

        raise GatewayError(f'Route "{call.route}" failed after {len(eligible)} attempt(s): {last_error}')


    def record_unusable_answer(self, model: str) -> None:
        """Tell the breaker that a model's answer could not be parsed.

        The gateway cannot judge this itself — it has no idea what the caller expects of
        the content. But a model that reliably returns unparseable JSON is as broken as one
        that times out, so the caller reports it and the ladder moves past that model
        instead of asking it the same question again.
        """
        self._breaker.record_failure(model)
