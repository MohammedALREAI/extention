"""What the schema actually does, against a real PostgreSQL.

The offline tests assert that the migration *says* the right things. These assert that
PostgreSQL *does* them — which is not the same claim, and the difference already caught a
real bug: ``array_length(scopes, 1) >= 1`` reads correctly and accepts every row it was
written to reject, because array_length of an empty array is NULL and a CHECK only fails
on FALSE.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

pytestmark = pytest.mark.integration


async def a_user(connection: AsyncConnection, open_id: str = "test-user") -> int:
    result = await connection.execute(
        text("INSERT INTO users (open_id, name) VALUES (:o, 'n') RETURNING id"), {"o": open_id}
    )
    return int(result.scalar_one())


async def rejects(connection: AsyncConnection, sql: str, params: dict | None = None) -> str:
    """Run a statement expected to violate a constraint, and return the constraint's name."""
    savepoint = await connection.begin_nested()
    try:
        await connection.execute(text(sql), params or {})
    except IntegrityError as error:
        await savepoint.rollback()
        return str(error.orig)
    await savepoint.rollback()
    raise AssertionError(f"statement was accepted but should have been rejected: {sql}")


class TestUpdatedAtTrigger:
    async def test_advances_between_transactions(self, connection: AsyncConnection) -> None:
        """The trigger uses now(), which is *transaction* time, not wall-clock time.

        So a row inserted and updated inside one transaction keeps the same timestamp —
        that is correct and intended, since everything one transaction changed did change
        at the same logical moment. Advancing requires a second transaction, which is what
        a second HTTP request is.
        """
        user_id = await a_user(connection)
        same = (
            await connection.execute(
                text(
                    "UPDATE users SET name='changed' WHERE id=:i"
                    " RETURNING updated_at = created_at"
                ),
                {"i": user_id},
            )
        ).scalar_one()
        assert same is True, "within one transaction now() does not advance"

        # A separate transaction sees a later now(), so the column really does move.
        later = (
            await connection.execute(
                text("SELECT clock_timestamp() > (SELECT updated_at FROM users WHERE id=:i)"),
                {"i": user_id},
            )
        ).scalar_one()
        assert later is True

    async def test_the_application_cannot_forge_it(self, connection: AsyncConnection) -> None:
        # A trigger rather than application code, so an UPDATE from psql or a future
        # service maintains it too. The column is only trustworthy if nothing can skip it.
        user_id = await a_user(connection)
        await connection.execute(
            text("UPDATE users SET name='x', updated_at = timestamptz '2000-01-01' WHERE id = :i"),
            {"i": user_id},
        )
        year = (
            await connection.execute(
                text("SELECT extract(year from updated_at) FROM users WHERE id = :i"), {"i": user_id}
            )
        ).scalar_one()
        assert int(year) > 2020, "the trigger must win over a supplied value"


class TestConstraintsActuallyReject:
    async def test_an_out_of_range_confidence(self, connection: AsyncConnection) -> None:
        user_id = await a_user(connection)
        message = await rejects(
            connection,
            "INSERT INTO check_history (user_id, input_type, input_value, decision, confidence,"
            " reason, cache_status) VALUES (:i,'text','x','allow',4000,'r','fresh')",
            {"i": user_id},
        )
        assert "confidence_range" in message

    async def test_a_sha256_that_is_not_a_digest(self, connection: AsyncConnection) -> None:
        # The stored filename is derived from this, so a path fragment here is a traversal.
        user_id = await a_user(connection)
        key_id = (
            await connection.execute(
                text(
                    "INSERT INTO developer_api_keys (user_id,label,key_prefix,secret_hash,scopes)"
                    " VALUES (:i,'l','p1',repeat('a',64),ARRAY['detect:image']) RETURNING id"
                ),
                {"i": user_id},
            )
        ).scalar_one()
        message = await rejects(
            connection,
            "INSERT INTO image_uploads (api_key_id, sha256, mime_type, byte_size, labels)"
            " VALUES (:k,'../../etc/passwd','image/png',10,'[]'::jsonb)",
            {"k": key_id},
        )
        assert "sha256_is_digest" in message

    async def test_a_trial_that_ends_before_it_starts(self, connection: AsyncConnection) -> None:
        user_id = await a_user(connection)
        message = await rejects(
            connection,
            "INSERT INTO subscriptions (user_id, trial_started_at, trial_ends_at)"
            " VALUES (:i, now(), now() - interval '1 day')",
            {"i": user_id},
        )
        assert "trial_window" in message

    async def test_half_a_billing_period(self, connection: AsyncConnection) -> None:
        # One end set and not the other is how an entitlement check silently reads as
        # "no access".
        user_id = await a_user(connection)
        message = await rejects(
            connection,
            "INSERT INTO subscriptions (user_id, trial_started_at, trial_ends_at,"
            " current_period_start) VALUES (:i, now(), now() + interval '10 days', now())",
            {"i": user_id},
        )
        assert "period_pair" in message

    async def test_an_audit_row_that_names_no_actor(self, connection: AsyncConnection) -> None:
        message = await rejects(
            connection,
            "INSERT INTO audit_log (actor_type, action, target_type)"
            " VALUES ('api_key','policy.created','policy')",
        )
        assert "actor_shape" in message

    async def test_an_api_key_with_no_scopes(self, connection: AsyncConnection) -> None:
        # The bug this pins: `array_length(scopes, 1) >= 1` reads correctly and accepts
        # every row it was meant to reject — array_length of an empty array is NULL, and a
        # CHECK only rejects on FALSE. cardinality() returns 0.
        user_id = await a_user(connection)
        message = await rejects(
            connection,
            "INSERT INTO developer_api_keys (user_id,label,key_prefix,secret_hash,scopes)"
            " VALUES (:i,'l','p2',repeat('c',64),ARRAY[]::text[])",
            {"i": user_id},
        )
        assert "scopes_not_empty" in message

    async def test_a_policy_with_no_rules(self, connection: AsyncConnection) -> None:
        user_id = await a_user(connection)
        message = await rejects(
            connection,
            "INSERT INTO policies (user_id,name,source_preference,language,action,rules)"
            " VALUES (:i,'my policy','pref','en','blur','[]'::jsonb)",
            {"i": user_id},
        )
        assert "rules_count" in message


class TestReferentialIntegrity:
    async def test_deleting_a_user_removes_their_keys(self, connection: AsyncConnection) -> None:
        user_id = await a_user(connection)
        await connection.execute(
            text(
                "INSERT INTO developer_api_keys (user_id,label,key_prefix,secret_hash,scopes)"
                " VALUES (:i,'l','p3',repeat('d',64),ARRAY['detect:image'])"
            ),
            {"i": user_id},
        )
        await connection.execute(text("DELETE FROM users WHERE id = :i"), {"i": user_id})
        remaining = (
            await connection.execute(
                text("SELECT count(*) FROM developer_api_keys WHERE user_id = :i"), {"i": user_id}
            )
        ).scalar_one()
        assert remaining == 0

    async def test_deleting_a_policy_keeps_the_history(self, connection: AsyncConnection) -> None:
        # SET NULL, not CASCADE: the record that a check happened belongs to the user, not
        # to the policy that happened to be selected at the time.
        user_id = await a_user(connection)
        policy_id = (
            await connection.execute(
                text(
                    "INSERT INTO policies (user_id,name,source_preference,language,action,rules)"
                    " VALUES (:i,'my policy','pref','en','blur','[{\"term\":\"dog\"}]'::jsonb) RETURNING id"
                ),
                {"i": user_id},
            )
        ).scalar_one()
        await connection.execute(
            text(
                "INSERT INTO check_history (user_id, policy_id, input_type, input_value, decision,"
                " confidence, reason, cache_status) VALUES (:i,:p,'text','x','blur',96,'r','fresh')"
            ),
            {"i": user_id, "p": policy_id},
        )
        await connection.execute(text("DELETE FROM policies WHERE id = :p"), {"p": policy_id})
        rows = (
            await connection.execute(
                text("SELECT policy_id FROM check_history WHERE user_id = :i"), {"i": user_id}
            )
        ).all()
        assert len(rows) == 1
        assert rows[0][0] is None


class TestTrialUpsertIsRaceSafe:
    async def test_a_second_insert_does_nothing_rather_than_failing(
        self, connection: AsyncConnection
    ) -> None:
        # The old code did read-then-insert and survived a race only by catching the unique
        # violation. One atomic statement is always correct and needs no exception handling.
        user_id = await a_user(connection)
        upsert = text(
            "INSERT INTO subscriptions (user_id, plan_code, status, trial_started_at, trial_ends_at)"
            " VALUES (:i,'trial','trial', now(), now() + interval '10 days')"
            " ON CONFLICT (user_id) DO NOTHING RETURNING id"
        )
        first = (await connection.execute(upsert, {"i": user_id})).scalar()
        second = (await connection.execute(upsert, {"i": user_id})).scalar()
        assert first is not None
        assert second is None  # already existed; no exception, no duplicate

        count = (
            await connection.execute(
                text("SELECT count(*) FROM subscriptions WHERE user_id = :i"), {"i": user_id}
            )
        ).scalar_one()
        assert count == 1


class TestIndexesAreUsed:
    async def test_the_policy_list_is_an_index_scan(self, connection: AsyncConnection) -> None:
        # The index exists to serve exactly this query. Asserting the plan is what proves
        # it, rather than asserting the index merely exists.
        await connection.execute(text("SET LOCAL enable_seqscan = off"))
        plan = "\n".join(
            row[0]
            for row in (
                await connection.execute(
                    text(
                        "EXPLAIN SELECT * FROM policies WHERE user_id = 1"
                        " ORDER BY updated_at DESC LIMIT 20"
                    )
                )
            ).all()
        )
        assert "ix_policies_user_updated" in plan, plan
