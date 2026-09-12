"""Authenticating an extension request against the database.

Four facts must hold, and each failure maps to a *different* status because the extension
shows the user a different message for each and decides differently whether to retry:

    401  the token does not verify, or names a user that no longer exists
    402  the account's access has ended
    404  the policy named by the token is gone, or belongs to someone else
    429  too many requests for this token

Getting one of those wrong is not cosmetic. 401, 402 and 429 are terminal — the client will
not retry them — so returning 429 for a fixable problem hides it behind "try again later",
and returning 502 for an expired subscription makes a billing issue look like an outage.

The whole check is one query plus, on a brand-new account, one insert.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Final, Protocol

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from contentfirewall.db.repositories.extension import ensure_trial, load_extension_context
from contentfirewall.db.session import unit_of_work
from contentfirewall.domain.extension_token import read_bearer, verify_extension_token
from contentfirewall.domain.subscription import has_access
from contentfirewall.services.extension_policy import Refusal, ResolvedPolicy

EXTENSION_RATE_LIMIT_PER_MINUTE: Final = 90


class RateLimiter(Protocol):
    """Shared, not per-process.

    The old limiter was a module-level dict, so N workers allowed N times the configured
    rate — a limit that quietly scaled with deployment topology. It was also keyed by the
    full token string and never evicted, which grew without bound.
    """

    async def allow(self, key: str, limit: int) -> bool: ...


class AlwaysAllow:
    """Used until the shared limiter lands, and honest about it.

    Named so that reading the wiring makes the gap obvious, rather than a silently absent
    limiter looking like a configured one.
    """

    async def allow(self, key: str, limit: int) -> bool:
        return True


async def resolve_from_database(
    *,
    session: AsyncSession,
    token: str,
    secret: str,
    rate_limiter: RateLimiter,
    now: datetime | None = None,
) -> ResolvedPolicy:
    """The full ladder, in the order that costs least before it can refuse.

    Signature first: it needs no I/O, so a forged token is rejected without touching the
    database at all.
    """
    claims = verify_extension_token(token, secret)
    if claims is None:
        return ResolvedPolicy(refusal=Refusal.INVALID_TOKEN)

    # Keyed by a digest of the token rather than the token itself: the limiter's keyspace
    # then has a fixed size per entry, and the key is not a credential.
    from hashlib import sha256

    digest = sha256(token.encode("utf-8")).hexdigest()
    if not await rate_limiter.allow(f"cf:rl:ext:{digest}", EXTENSION_RATE_LIMIT_PER_MINUTE):
        return ResolvedPolicy(refusal=Refusal.RATE_LIMITED)

    context = await load_extension_context(
        session, user_id=claims.user_id, policy_id=claims.policy_id
    )
    if context is None:
        return ResolvedPolicy(refusal=Refusal.UNKNOWN_USER)

    subscription = context.subscription
    if subscription is None:
        # A user who has never been summarised has no row yet. Materialising it here keeps
        # a first request working instead of failing on an absence that is not the user's
        # fault.
        subscription = await ensure_trial(
            session, user_id=context.user_id, started_at=context.user_created_at
        )
    if not has_access(subscription, now or datetime.now(UTC)):
        return ResolvedPolicy(refusal=Refusal.ACCESS_ENDED)

    # Ownership is enforced by the join, not by a second check: the policy row is NULL
    # unless it belongs to this user, so there is no window between checking and using.
    if not context.has_policy:
        return ResolvedPolicy(refusal=Refusal.POLICY_NOT_FOUND)

    return ResolvedPolicy(
        source_preference=context.source_preference,
        rules=list(context.rules),
    )


def make_database_resolver(
    factory: async_sessionmaker[AsyncSession],
    *,
    secret: str,
    rate_limiter: RateLimiter | None = None,
) -> Callable[[Any, Any], Awaitable[ResolvedPolicy]]:
    """Wire the ladder to a session factory for the extension router to call."""
    limiter = rate_limiter or AlwaysAllow()

    async def resolve(request: Any, payload: Any) -> ResolvedPolicy:
        token = read_bearer(request.headers.get("authorization"))
        async with unit_of_work(factory) as session:
            return await resolve_from_database(
                session=session, token=token, secret=secret, rate_limiter=limiter
            )

    return resolve
