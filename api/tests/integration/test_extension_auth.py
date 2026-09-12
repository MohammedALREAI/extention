"""The auth ladder, against a real database.

This is the half of the frozen contract that could not be captured from the Node server:
those paths only run with the dev bypass *off*, which needs a real user, subscription and
stored policy.

Each status matters separately because the extension treats them differently. 401, 402 and
429 are terminal — it will not retry them — so returning 429 for a fixable problem hides it
behind "try again later", and returning 502 for an expired subscription makes a billing
issue look like an outage.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker

from contentfirewall.api.extension.policy import wire_error_for
from contentfirewall.domain.extension_token import mint_extension_token, verify_extension_token
from contentfirewall.services.extension_auth import (
    EXTENSION_RATE_LIMIT_PER_MINUTE,
    AlwaysAllow,
    resolve_from_database,
)

pytestmark = pytest.mark.integration

SECRET = "test-secret-value"


def status_of(resolved) -> int:
    """The wire status a refusal renders as — the part installed clients depend on."""
    assert resolved.refusal is not None, "expected a refusal, got an allowed policy"
    return wire_error_for(resolved.refusal).status


class DenyAll:
    async def allow(self, key: str, limit: int) -> bool:
        return False


@pytest.fixture
async def db(connection: AsyncConnection):
    maker = async_sessionmaker(bind=connection, join_transaction_mode="create_savepoint")
    async with maker() as session:
        yield session


async def make_account(
    session: AsyncSession,
    *,
    open_id: str = "auth-user",
    created_days_ago: int = 1,
    status: str = "trial",
    trial_days: int = 10,
    with_policy: bool = True,
    terms: tuple[str, ...] = ("cat",),
) -> tuple[int, int | None]:
    created = datetime.now(UTC) - timedelta(days=created_days_ago)
    user_id = (
        await session.execute(
            text("INSERT INTO users (open_id, name, created_at) VALUES (:o,'n',:c) RETURNING id"),
            {"o": open_id, "c": created},
        )
    ).scalar_one()
    await session.execute(
        text(
            "INSERT INTO subscriptions (user_id, plan_code, status, trial_started_at, trial_ends_at)"
            " VALUES (:u,'trial',:s,:a,:b)"
        ),
        {
            "u": user_id,
            "s": status,
            "a": created,
            "b": created + timedelta(days=trial_days),
        },
    )
    policy_id = None
    if with_policy:
        rules = "[" + ",".join(f'{{"term":"{t}","action":"blur"}}' for t in terms) + "]"
        policy_id = (
            await session.execute(
                text(
                    "INSERT INTO policies (user_id,name,source_preference,language,action,rules)"
                    " VALUES (:u,'my policy',:p,'en','blur', CAST(:r AS jsonb)) RETURNING id"
                ),
                {"u": user_id, "p": f"Do not show me: {', '.join(terms)}", "r": rules},
            )
        ).scalar_one()
    return int(user_id), policy_id


async def resolve(session: AsyncSession, token: str, limiter=None):
    return await resolve_from_database(
        session=session, token=token, secret=SECRET, rate_limiter=limiter or AlwaysAllow()
    )


class TestSuccess:
    async def test_a_valid_token_yields_the_stored_policy(self, db: AsyncSession) -> None:
        user_id, policy_id = await make_account(db, terms=("cat", "dog"))
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)

        resolved = await resolve(db, token)

        assert resolved.refusal is None
        assert [rule.term for rule in resolved.rules] == ["cat", "dog"]
        assert resolved.source_preference == "Do not show me: cat, dog"

    async def test_a_user_with_no_subscription_row_gets_a_trial(self, db: AsyncSession) -> None:
        # A first request must not fail on an absence that is not the user's fault.
        created = datetime.now(UTC) - timedelta(days=1)
        user_id = (
            await db.execute(
                text("INSERT INTO users (open_id, created_at) VALUES ('fresh',:c) RETURNING id"),
                {"c": created},
            )
        ).scalar_one()
        policy_id = (
            await db.execute(
                text(
                    "INSERT INTO policies (user_id,name,source_preference,language,action,rules)"
                    " VALUES (:u,'my policy','pref','en','blur','[{\"term\":\"cat\"}]'::jsonb)"
                    " RETURNING id"
                ),
                {"u": user_id},
            )
        ).scalar_one()
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)

        resolved = await resolve(db, token)

        assert resolved.refusal is None
        count = (
            await db.execute(
                text("SELECT count(*) FROM subscriptions WHERE user_id = :u"), {"u": user_id}
            )
        ).scalar_one()
        assert count == 1


class TestRefusals:
    async def test_a_forged_token_is_401_without_touching_the_database(
        self, db: AsyncSession
    ) -> None:
        resolved = await resolve(db, "not.a.real.token")
        assert status_of(resolved) == 401

    async def test_a_token_signed_with_another_secret_is_401(self, db: AsyncSession) -> None:
        user_id, policy_id = await make_account(db)
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret="wrong-secret")
        resolved = await resolve(db, token)
        assert status_of(resolved) == 401

    async def test_a_tampered_payload_is_401(self, db: AsyncSession) -> None:
        # Swapping in someone else's user id must not survive the signature check.
        user_id, policy_id = await make_account(db)
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)
        payload, signature = token.split(".")
        forged = f"{payload[:-4]}AAAA.{signature}"
        resolved = await resolve(db, forged)
        assert status_of(resolved) == 401

    async def test_an_expired_token_is_401(self, db: AsyncSession) -> None:
        user_id, policy_id = await make_account(db)
        past = datetime.now(UTC).timestamp() - 60 * 60 * 24 * 40  # minted 40 days ago
        token, _ = mint_extension_token(
            policy_id=policy_id, user_id=user_id, secret=SECRET, now=past
        )
        assert verify_extension_token(token, SECRET) is None
        resolved = await resolve(db, token)
        assert status_of(resolved) == 401

    async def test_a_token_for_a_deleted_user_is_401(self, db: AsyncSession) -> None:
        user_id, policy_id = await make_account(db, open_id="to-delete")
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)
        await db.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
        resolved = await resolve(db, token)
        assert status_of(resolved) == 401

    async def test_an_ended_trial_is_402_not_401(self, db: AsyncSession) -> None:
        # A billing state, not an authentication one. The client shows a different message
        # and must not treat it as a broken policy import.
        user_id, policy_id = await make_account(db, created_days_ago=40, trial_days=10)
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)
        resolved = await resolve(db, token)
        assert status_of(resolved) == 402

    async def test_a_cancelled_subscription_keeps_access_until_the_period_ends(
        self, db: AsyncSession
    ) -> None:
        # Somebody who cancelled has paid for the remainder; cutting them off early takes
        # back something they bought.
        user_id, policy_id = await make_account(db, created_days_ago=40, status="cancelled")
        await db.execute(
            text(
                "UPDATE subscriptions SET current_period_start = now(),"
                " current_period_end = now() + interval '5 days' WHERE user_id = :u"
            ),
            {"u": user_id},
        )
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)
        resolved = await resolve(db, token)
        assert resolved.refusal is None

    async def test_a_missing_policy_is_404(self, db: AsyncSession) -> None:
        user_id, policy_id = await make_account(db)
        await db.execute(text("DELETE FROM policies WHERE id = :p"), {"p": policy_id})
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)
        resolved = await resolve(db, token)
        assert status_of(resolved) == 404

    async def test_another_users_policy_is_404_not_someone_elses_rules(
        self, db: AsyncSession
    ) -> None:
        # The ownership check is the join itself, so there is no window between checking
        # and using — and the failure is indistinguishable from the policy not existing,
        # which is what stops this being a way to probe for other people's policy ids.
        _, victim_policy = await make_account(db, open_id="victim", terms=("secret-term",))
        attacker_id, _ = await make_account(db, open_id="attacker")
        token, _ = mint_extension_token(
            policy_id=victim_policy, user_id=attacker_id, secret=SECRET
        )

        resolved = await resolve(db, token)

        assert status_of(resolved) == 404
        assert resolved.rules == []

    async def test_too_many_requests_is_429(self, db: AsyncSession) -> None:
        user_id, policy_id = await make_account(db)
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)
        resolved = await resolve(db, token, limiter=DenyAll())
        assert status_of(resolved) == 429

    async def test_the_rate_limit_is_the_documented_one(self) -> None:
        assert EXTENSION_RATE_LIMIT_PER_MINUTE == 90


class TestQueryCount:
    async def test_a_warm_request_costs_one_query(self, db: AsyncSession) -> None:
        """The point of the join.

        The TypeScript path did four to five round trips before it reached a model: load
        user, load subscription, maybe insert a trial, maybe write a corrected status, then
        load the policy.
        """
        user_id, policy_id = await make_account(db, open_id="counted")
        token, _ = mint_extension_token(policy_id=policy_id, user_id=user_id, secret=SECRET)

        statements: list[str] = []
        from sqlalchemy import event

        engine = db.get_bind().engine

        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", record)
        try:
            resolved = await resolve(db, token)
        finally:
            event.remove(engine, "before_cursor_execute", record)

        assert resolved.refusal is None
        selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
        assert len(selects) == 1, selects
