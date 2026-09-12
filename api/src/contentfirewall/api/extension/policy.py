"""How a refusal is rendered on the wire, and the development bypass.

The *reasons* live in ``services.extension_policy``; this module maps them onto the exact
status codes and messages installed extensions already depend on. Keeping the mapping in
one small table makes the frozen contract readable, and makes changing it look as
deliberate as it is — 401, 402 and 429 are terminal for the client, so a wrong code either
wastes its rate limit or hides a fixable problem behind "try again later".
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final, Protocol

from contentfirewall.api.extension.normalize import request_rule_terms
from contentfirewall.domain.models import FirewallRule, PolicyAction
from contentfirewall.services.extension_policy import Refusal, ResolvedPolicy

DEFAULT_DEV_RULES: Final = "dog"


@dataclass(frozen=True, slots=True)
class WireError:
    status: int
    message: str


# The frozen ladder. Each line is a promise to software that cannot be updated.
REFUSAL_RESPONSES: Final[dict[Refusal, WireError]] = {
    Refusal.INVALID_TOKEN: WireError(401, "Invalid extension access token."),
    Refusal.UNKNOWN_USER: WireError(401, "Subscription account was not found."),
    Refusal.ACCESS_ENDED: WireError(402, "Trial or subscription access has ended."),
    Refusal.RATE_LIMITED: WireError(429, "Too many checks. Retry shortly."),
    Refusal.POLICY_NOT_FOUND: WireError(404, "Policy not found."),
}


def wire_error_for(refusal: Refusal) -> WireError:
    return REFUSAL_RESPONSES[refusal]


class PolicyResolver(Protocol):
    async def __call__(self, request: Any, payload: Any) -> ResolvedPolicy: ...


def dev_auth_bypass_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Double-gated, and the second gate is the one that matters.

    ``CF_DEV_NO_AUTH`` alone is not enough: the environment must also not be production, so
    a flag left set in a deployed build cannot expose the endpoint.
    """
    source = os.environ if env is None else env
    return (
        source.get("NODE_ENV") != "production"
        and source.get("CF_ENV") != "production"
        and source.get("CF_DEV_NO_AUTH") == "1"
    )


def dev_policy(payload: Any, env: Mapping[str, str] | None = None) -> ResolvedPolicy:
    """Build a policy from the terms the request sent, falling back to the environment.

    Preferring the request's own terms matters: without it, text masking follows the user's
    real rules while image detection hunts whatever ``CF_DEV_RULES`` happens to say, and
    nothing on screen explains why only half the page is filtered.
    """
    source = os.environ if env is None else env
    requested = request_rule_terms(payload)
    fallback = [
        term.strip()
        for term in source.get("CF_DEV_RULES", DEFAULT_DEV_RULES).split(",")
        if term.strip()
    ]
    terms = requested or fallback or [DEFAULT_DEV_RULES]
    rules = [FirewallRule(term=term, action=PolicyAction.BLUR) for term in terms]
    return ResolvedPolicy(
        source_preference=f"Do not show me: {', '.join(rule.term for rule in rules)}",
        rules=rules,
    )


def make_dev_resolver(env: Mapping[str, str] | None = None) -> PolicyResolver:
    async def resolve(request: Any, payload: Any) -> ResolvedPolicy:
        return dev_policy(payload, env)

    return resolve


def make_unconfigured_resolver() -> PolicyResolver:
    """Used when neither the bypass nor a database is available.

    Refuses every request with the same 401 a forged token gets. Answering would mean
    checking against no policy at all, which looks exactly like protection and is not.
    """

    async def resolve(request: Any, payload: Any) -> ResolvedPolicy:
        return ResolvedPolicy(refusal=Refusal.INVALID_TOKEN)

    return resolve
