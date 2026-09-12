"""The baseline migration, checked by rendering it to SQL — no database required.

Alembic's offline mode emits exactly the statements it would run, so every correction the
baseline exists to carry can be asserted here. The ones that matter are the ones the old
schema got wrong, because those are the ones somebody could reintroduce.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

API_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def baseline_sql() -> str:
    """The SQL `alembic upgrade head --sql` would emit, with no database involved.

    The URL is required by env.py but never connected to in offline mode; it only tells
    Alembic which dialect to render for.
    """
    import os

    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "postgresql://u:p@localhost:5432/render_only"
    try:
        buffer = io.StringIO()
        config = Config(str(API_ROOT / "alembic.ini"), output_buffer=buffer)
        config.set_main_option("script_location", str(API_ROOT / "alembic"))
        command.upgrade(config, "head", sql=True)
        rendered = buffer.getvalue()
        assert rendered.strip(), "offline render produced nothing; the fixture is broken"
        return rendered
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous


def created_enums(sql: str) -> set[str]:
    return set(re.findall(r"CREATE TYPE (\w+) AS ENUM", sql))


def created_indexes(sql: str) -> set[str]:
    return set(re.findall(r"CREATE INDEX (\w+)", sql))


class TestEnumCollision:
    def test_no_enum_is_named_status(self, baseline_sql: str) -> None:
        # drizzle/schema.ts declared two different pgEnums both literally named "status" —
        # subscriptions (trial/active/expired/cancelled) and developer_api_keys
        # (active/revoked). PostgreSQL cannot create that type twice, so the old schema
        # could not actually be applied as written.
        assert "status" not in created_enums(baseline_sql)

    def test_each_enum_is_named_for_what_it_holds(self, baseline_sql: str) -> None:
        assert created_enums(baseline_sql) == {
            "user_role",
            "subscription_status",
            "api_key_status",
            "policy_action",
            "check_input_type",
            "check_decision",
            "cache_status",
            "audit_actor_type",
        }


class TestMissingIndexes:
    @pytest.mark.parametrize(
        ("index", "why"),
        [
            ("ix_policies_user_updated", "listPoliciesForUser filters user_id, orders updated_at"),
            ("ix_check_history_user_created", "history is WHERE user_id ORDER BY created_at DESC"),
            ("ix_developer_api_keys_user_created", "keys are always listed per user"),
            ("ix_image_uploads_key_created", "an FK with no index makes cascade delete a seq scan"),
        ],
    )
    def test_the_index_each_query_needed(self, baseline_sql: str, index: str, why: str) -> None:
        assert index in created_indexes(baseline_sql), why

    def test_the_policy_index_can_serve_the_ordering(self, baseline_sql: str) -> None:
        # Declared DESC so the list is served by the index rather than an extra sort.
        assert "updated_at DESC" in baseline_sql

    def test_scopes_are_searchable_in_sql(self, baseline_sql: str) -> None:
        # text[] with a GIN index, so a scope check is a predicate rather than loading the
        # row and checking in Python.
        assert "USING gin" in baseline_sql


class TestUpdatedAtTrigger:
    def test_every_mutable_table_maintains_it(self, baseline_sql: str) -> None:
        # The column existed and defaulted to now(), but nothing ever wrote it — so the
        # policy list, which orders by updated_at, was really ordered by creation time.
        triggers = set(re.findall(r"CREATE TRIGGER (\w+)", baseline_sql))
        assert triggers == {
            "users_set_updated_at",
            "subscriptions_set_updated_at",
            "policies_set_updated_at",
            "developer_api_keys_set_updated_at",
        }

    def test_the_function_is_created_before_the_triggers(self, baseline_sql: str) -> None:
        assert baseline_sql.index("FUNCTION set_updated_at") < baseline_sql.index("CREATE TRIGGER")


class TestTimestamps:
    def test_every_timestamp_carries_a_timezone(self, baseline_sql: str) -> None:
        # Naive timestamps silently depend on the server's TimeZone setting, which is a
        # latent bug anywhere dates are compared — and subscription expiry is exactly that.
        naive = re.findall(r"\w+ TIMESTAMP(?! WITH TIME ZONE)\b", baseline_sql)
        assert not naive, naive


class TestConstraints:
    @pytest.mark.parametrize(
        "fragment",
        [
            "confidence between 0 and 100",
            "trial_ends_at > trial_started_at",
            "(current_period_start IS NULL) = (current_period_end IS NULL)",
            "jsonb_array_length(rules) between 1 and 12",
            "sha256 ~ '^[a-f0-9]{64}$'",
            "secret_hash ~ '^[a-f0-9]{64}$'",
            "http_status between 100 and 599",
            "array_length(scopes, 1) >= 1",
        ],
    )
    def test_the_invariants_the_application_only_assumed(self, baseline_sql: str, fragment: str) -> None:
        assert fragment in baseline_sql

    def test_an_audit_row_must_identify_its_actor(self, baseline_sql: str) -> None:
        # A row saying "an api_key did this" with no key id is not an audit record.
        assert "actor_shape" in baseline_sql
        assert "actor_type = 'api_key'" in baseline_sql


class TestPrivacyInvariant:
    def test_the_usage_ledger_says_so_in_the_database(self, baseline_sql: str) -> None:
        # Stated where it survives contact with someone who never read the model docstring.
        assert "Aggregate counters only" in baseline_sql

    def test_the_usage_ledger_has_no_free_text_columns(self) -> None:
        from contentfirewall.db.models import DeveloperApiUsage

        columns = {column.name for column in DeveloperApiUsage.__table__.columns}
        assert columns == {
            "id",
            "api_key_id",
            "item_count",
            "match_count",
            "no_match_count",
            "unavailable_count",
            "latency_ms",
            "http_status",
            "created_at",
        }


class TestReversibility:
    def test_downgrade_drops_the_enums_too(self) -> None:
        # drop_table leaves enum types behind, so a downgrade-then-upgrade would collide on
        # a type that already exists.
        source = (API_ROOT / "alembic" / "versions" / "0001_baseline.py").read_text(encoding="utf-8")
        downgrade = source.split("def downgrade()")[1]
        for enum in ("user_role", "subscription_status", "api_key_status", "audit_actor_type"):
            assert enum in downgrade

    def test_downgrade_drops_tables_child_first(self) -> None:
        source = (API_ROOT / "alembic" / "versions" / "0001_baseline.py").read_text(encoding="utf-8")
        downgrade = source.split("def downgrade()")[1]
        assert downgrade.index("audit_log") < downgrade.index('"users"')
