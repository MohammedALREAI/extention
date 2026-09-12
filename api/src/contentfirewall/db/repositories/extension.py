"""Everything an extension request needs, in one query.

The TypeScript path did four to five round trips before it reached a model: load the user,
load the subscription, possibly insert a trial, possibly write a corrected status, then
load the policy. All of that is one join — the request needs one user, one subscription and
one policy, and the database can produce them together.

The status write is gone entirely. ``has_access`` is computed from dates (see
``domain.subscription``), so nothing on this path writes, which is also what makes the
read cacheable and the handler genuinely read-only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from contentfirewall.domain.models import FirewallRule, PolicyAction
from contentfirewall.domain.subscription import SubscriptionRow, trial_ends_at

# LEFT JOINs on purpose: a missing subscription or a policy that belongs to someone else
# must come back as NULL rather than as no row, so the caller can tell "no such user" from
# "user exists, policy is not theirs" — two different answers to the client.
_CONTEXT_SQL = text("""
    SELECT
        u.id                        AS user_id,
        u.created_at                AS user_created_at,
        s.status                    AS sub_status,
        s.plan_code                 AS sub_plan_code,
        s.trial_started_at          AS sub_trial_started_at,
        s.trial_ends_at             AS sub_trial_ends_at,
        s.current_period_start      AS sub_current_period_start,
        s.current_period_end        AS sub_current_period_end,
        s.cancel_at_period_end      AS sub_cancel_at_period_end,
        s.cancelled_at              AS sub_cancelled_at,
        p.id                        AS policy_id,
        p.source_preference         AS policy_source_preference,
        p.rules                     AS policy_rules,
        p.version                   AS policy_version,
        p.scope_text                AS policy_scope_text,
        p.scope_images              AS policy_scope_images
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    LEFT JOIN policies p ON p.id = :policy_id AND p.user_id = u.id
    WHERE u.id = :user_id
""")

_ENSURE_TRIAL_SQL = text("""
    INSERT INTO subscriptions (user_id, plan_code, status, trial_started_at, trial_ends_at)
    VALUES (:user_id, 'trial', 'trial', :started_at, :ends_at)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING status, plan_code, trial_started_at, trial_ends_at,
              current_period_start, current_period_end, cancel_at_period_end, cancelled_at
""")

_SEEN_RECENTLY_SQL = text("UPDATE users SET last_signed_in = now() WHERE id = :user_id")


@dataclass(frozen=True, slots=True)
class ExtensionContext:
    """The answer to "who is asking, may they, and what are they checking for"."""

    user_id: int
    user_created_at: datetime
    subscription: SubscriptionRow | None
    policy_id: int | None
    source_preference: str
    rules: tuple[FirewallRule, ...]
    policy_version: int

    @property
    def has_policy(self) -> bool:
        return self.policy_id is not None


def _subscription_from(row: Any) -> SubscriptionRow | None:
    if row.sub_status is None:
        return None
    return SubscriptionRow(
        status=row.sub_status,
        plan_code=row.sub_plan_code,
        trial_started_at=row.sub_trial_started_at,
        trial_ends_at=row.sub_trial_ends_at,
        current_period_start=row.sub_current_period_start,
        current_period_end=row.sub_current_period_end,
        cancel_at_period_end=row.sub_cancel_at_period_end,
        cancelled_at=row.sub_cancelled_at,
    )


def _rules_from(raw: Any) -> tuple[FirewallRule, ...]:
    if not isinstance(raw, list):
        return ()
    rules: list[FirewallRule] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        term = str(entry.get("term") or "").strip()
        if not term:
            continue
        action = entry.get("action")
        rules.append(
            FirewallRule(
                term=term,
                action=PolicyAction(action) if action in set(PolicyAction) else PolicyAction.BLUR,
            )
        )
    return tuple(rules)


async def load_extension_context(
    session: AsyncSession, *, user_id: int, policy_id: int
) -> ExtensionContext | None:
    """One query. ``None`` means there is no such user."""
    row = (await session.execute(_CONTEXT_SQL, {"user_id": user_id, "policy_id": policy_id})).one_or_none()
    if row is None:
        return None
    return ExtensionContext(
        user_id=row.user_id,
        user_created_at=row.user_created_at,
        subscription=_subscription_from(row),
        policy_id=row.policy_id,
        source_preference=row.policy_source_preference or "",
        rules=_rules_from(row.policy_rules),
        policy_version=row.policy_version or 0,
    )


async def ensure_trial(
    session: AsyncSession, *, user_id: int, started_at: datetime
) -> SubscriptionRow:
    """Materialise the trial, exactly once, without a race.

    The TypeScript version read, inserted, caught the unique violation, then read again —
    correct only by accident of that catch, and three round trips on a first request. One
    statement is always correct: an existing row makes this a no-op and the follow-up
    SELECT runs only then.
    """
    ends_at = trial_ends_at(started_at)
    inserted = (
        await session.execute(
            _ENSURE_TRIAL_SQL, {"user_id": user_id, "started_at": started_at, "ends_at": ends_at}
        )
    ).one_or_none()
    if inserted is not None:
        return SubscriptionRow(
            status=inserted.status,
            plan_code=inserted.plan_code,
            trial_started_at=inserted.trial_started_at,
            trial_ends_at=inserted.trial_ends_at,
            current_period_start=inserted.current_period_start,
            current_period_end=inserted.current_period_end,
            cancel_at_period_end=inserted.cancel_at_period_end,
            cancelled_at=inserted.cancelled_at,
        )

    existing = (
        await session.execute(
            text(
                "SELECT status, plan_code, trial_started_at, trial_ends_at, current_period_start,"
                " current_period_end, cancel_at_period_end, cancelled_at"
                " FROM subscriptions WHERE user_id = :user_id"
            ),
            {"user_id": user_id},
        )
    ).one()
    return SubscriptionRow(
        status=existing.status,
        plan_code=existing.plan_code,
        trial_started_at=existing.trial_started_at,
        trial_ends_at=existing.trial_ends_at,
        current_period_start=existing.current_period_start,
        current_period_end=existing.current_period_end,
        cancel_at_period_end=existing.cancel_at_period_end,
        cancelled_at=existing.cancelled_at,
    )


async def touch_last_signed_in(session: AsyncSession, *, user_id: int) -> None:
    """Record that the user was seen.

    Called at most once an hour per user, gated by a short-lived cache key — the previous
    implementation wrote this on *every* request, which put a row update in front of every
    read the system served.
    """
    await session.execute(_SEEN_RECENTLY_SQL, {"user_id": user_id})
