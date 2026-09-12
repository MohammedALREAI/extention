"""Deciding what a request is allowed to ask for, and what it is checking against.

Two paths. In production every request must prove who it is, that its access is current,
and that the policy it names belongs to it — four facts, and a failure in any of them maps
to a specific status the extension shows the user differently.

In development the bypass skips all of it and synthesises a policy from the terms the
request itself sent. That is only safe because it is double-gated: it needs both a
non-production environment *and* an explicit opt-in. A stray flag in a deployed build must
not open the endpoint to anyone who can reach it.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final, Protocol

from contentfirewall.api.extension.normalize import request_rule_terms
from contentfirewall.domain.models import FirewallRule, PolicyAction

DEFAULT_DEV_RULES: Final = "dog"


@dataclass(frozen=True, slots=True)
class PolicyError:
    """A refusal the extension renders as a distinct, actionable message."""

    status: int
    message: str


# The exact ladder the client maps to user-visible outcomes. 401, 402 and 429 are terminal
# — it will not retry them — so returning the wrong one either wastes the rate limit or
# hides a fixable problem behind "try again".
INVALID_TOKEN: Final = PolicyError(401, "Invalid extension access token.")
UNKNOWN_USER: Final = PolicyError(401, "Subscription account was not found.")
ACCESS_ENDED: Final = PolicyError(402, "Trial or subscription access has ended.")
RATE_LIMITED: Final = PolicyError(429, "Too many checks. Retry shortly.")
POLICY_NOT_FOUND: Final = PolicyError(404, "Policy not found.")


@dataclass(frozen=True, slots=True)
class ResolvedPolicy:
    source_preference: str = ""
    rules: list[FirewallRule] = field(default_factory=list)
    error: PolicyError | None = None


class PolicyResolver(Protocol):
    async def __call__(self, request: Any, payload: Any) -> ResolvedPolicy: ...


def dev_auth_bypass_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Double-gated, and the second gate is the one that matters.

    ``CF_DEV_NO_AUTH`` alone is not enough: the environment must also not be production, so
    that a flag left set in a deployed build cannot expose the endpoint.
    """
    source = os.environ if env is None else env
    return source.get("NODE_ENV") != "production" and source.get("CF_ENV") != "production" and source.get("CF_DEV_NO_AUTH") == "1"


def dev_policy(payload: Any, env: Mapping[str, str] | None = None) -> ResolvedPolicy:
    """Build a policy from the terms the request sent, falling back to the environment.

    Preferring the request's own terms matters: without it, text masking follows the user's
    real rules while image detection hunts whatever ``CF_DEV_RULES`` happens to say, and
    nothing on screen explains why only half the page is filtered.
    """
    source = os.environ if env is None else env
    requested = request_rule_terms(payload)
    fallback = [term.strip() for term in source.get("CF_DEV_RULES", DEFAULT_DEV_RULES).split(",") if term.strip()]
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

    Refuses every request with the same 401 a forged token gets. Returning boxes here would
    mean checking against nothing, which looks like protection and is not.
    """

    async def resolve(request: Any, payload: Any) -> ResolvedPolicy:
        return ResolvedPolicy(error=INVALID_TOKEN)

    return resolve
