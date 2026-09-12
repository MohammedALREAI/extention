"""Entitlement: whether an account may use the service right now.

Pure date arithmetic over a stored row. That is deliberate and is the fix for a real
problem — the previous implementation *wrote* a corrected status back to the database
during a read, so a GET was never actually read-only. That made a unit-of-work per request
unsafe and put a write on the hottest path in the system.

Here ``has_access`` is computed, never stored. The persisted ``status`` column is a cache
of this answer, reconciled by a scheduled job, and nothing on a read path depends on it
being fresh.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Final, Literal

_PLANS_FILE: Final = Path(__file__).resolve().parents[4] / "shared" / "plans.json"

SubscriptionStatus = Literal["trial", "active", "expired", "cancelled"]
AccountType = Literal[
    "free_trial", "monthly_subscription", "yearly_subscription", "expired_no_subscription"
]


@dataclass(frozen=True, slots=True)
class Plan:
    code: str
    name: str
    amount_cents: int
    currency: str
    billing_period: str


@lru_cache(maxsize=1)
def plan_catalog() -> tuple[int, dict[str, Plan]]:
    """``(trial_length_days, plans)`` from the file the TypeScript client also reads."""
    data = json.loads(_PLANS_FILE.read_text(encoding="utf-8"))
    plans = {
        code: Plan(
            code=entry["code"],
            name=entry["name"],
            amount_cents=entry["amountCents"],
            currency=entry["currency"],
            billing_period=entry["billingPeriod"],
        )
        for code, entry in data["plans"].items()
    }
    return int(data["trialLengthDays"]), plans


def trial_length_days() -> int:
    return plan_catalog()[0]


def trial_ends_at(started_at: datetime) -> datetime:
    return started_at + timedelta(days=trial_length_days())


def days_remaining_until(end: datetime | None, now: datetime | None = None) -> int:
    """Whole days left, rounded up, never negative."""
    if end is None:
        return 0
    moment = now or datetime.now(UTC)
    seconds = (end - moment).total_seconds()
    if seconds <= 0:
        return 0
    return int(-(-seconds // 86_400))  # ceil without importing math


@dataclass(frozen=True, slots=True)
class SubscriptionRow:
    """The stored entitlement, as read from the database."""

    status: SubscriptionStatus
    plan_code: str
    trial_started_at: datetime
    trial_ends_at: datetime
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    cancelled_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class SubscriptionSummary:
    account_type: AccountType
    status: SubscriptionStatus
    plan_code: str
    has_access: bool
    days_remaining: int
    trial_started_at: datetime
    trial_ends_at: datetime
    current_period_start: datetime | None
    current_period_end: datetime | None
    price_cents: int | None
    currency: str | None
    billing_period: str | None
    cancel_at_period_end: bool
    cancelled_at: datetime | None
    payment_setup_required: bool
    billing_available: bool


def has_access(row: SubscriptionRow, now: datetime | None = None) -> bool:
    """An active trial, or a paid period that has not ended yet.

    ``cancelled`` still grants access until the period ends — somebody who cancelled has
    paid for the remainder and cutting them off early would be taking it back.
    """
    moment = now or datetime.now(UTC)
    active_trial = row.status == "trial" and row.trial_ends_at > moment
    paid_period = (
        row.status in ("active", "cancelled")
        and row.current_period_end is not None
        and row.current_period_end > moment
    )
    return active_trial or paid_period


def reconciled_status(row: SubscriptionRow, now: datetime | None = None) -> SubscriptionStatus:
    """What the stored ``status`` column *should* say.

    Computed here and written by a scheduled job, never on a read path.
    """
    if not has_access(row, now):
        return "expired"
    return row.status


def _account_type(plan_code: str, allowed: bool) -> AccountType:
    if not allowed:
        return "expired_no_subscription"
    if plan_code == "monthly":
        return "monthly_subscription"
    if plan_code == "yearly":
        return "yearly_subscription"
    return "free_trial"


def summarize(
    row: SubscriptionRow, *, now: datetime | None = None, billing_available: bool = False
) -> SubscriptionSummary:
    moment = now or datetime.now(UTC)
    allowed = has_access(row, moment)
    _, plans = plan_catalog()
    paid = plans.get(row.plan_code)
    access_end = row.current_period_end if paid else row.trial_ends_at
    known_plan = row.plan_code if row.plan_code in {*plans, "trial"} else "none"

    return SubscriptionSummary(
        account_type=_account_type(row.plan_code, allowed),
        status=reconciled_status(row, moment),
        plan_code=known_plan,
        has_access=allowed,
        days_remaining=days_remaining_until(access_end, moment),
        trial_started_at=row.trial_started_at,
        trial_ends_at=row.trial_ends_at,
        current_period_start=row.current_period_start,
        current_period_end=row.current_period_end,
        price_cents=paid.amount_cents if paid else None,
        currency=paid.currency if paid else None,
        billing_period=paid.billing_period if paid else None,
        cancel_at_period_end=row.cancel_at_period_end,
        cancelled_at=row.cancelled_at,
        payment_setup_required=paid is None and not billing_available,
        billing_available=billing_available,
    )
