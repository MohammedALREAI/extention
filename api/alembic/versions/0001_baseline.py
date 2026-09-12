"""baseline

The first and only description of this schema. The previous migrations were MySQL — wrong
dialect, wrong syntax, and missing a table entirely — so there is no history to preserve
and nothing here is a delta against anything.

Corrections carried in deliberately, each fixing something the old schema got wrong:

* every enum has a distinct name. Two were both called "status", which PostgreSQL cannot
  create twice.
* indexes exist on the columns every query filters by. Several had none at all.
* updated_at is maintained by a trigger. It defaulted to now() and was then never written,
  so the policy list — which orders by it — was really ordered by creation time.
* timestamps are timestamptz. Naive ones depend on the server TimeZone, which is a latent
  bug wherever dates are compared, and subscription expiry is exactly that.
* CHECK constraints encode the invariants the application assumed but never enforced.

Revision ID: 0001_baseline
Revises:
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# One function, reused by every table that tracks modification time. Written as a trigger
# rather than left to the application because an UPDATE issued from psql or a future
# service must maintain it too — the column is only trustworthy if nothing can skip it.
SET_UPDATED_AT = """
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
"""

UPDATED_AT_TABLES = ("users", "subscriptions", "policies", "developer_api_keys")


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('open_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.Text(), nullable=True),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('login_method', sa.String(length=64), nullable=True),
    sa.Column('role', sa.Enum('user', 'admin', name='user_role'), server_default='user', nullable=False),
    sa.Column('last_signed_in', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('char_length(open_id) between 1 and 64', name=op.f('ck_users_open_id_length')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('open_id', name=op.f('uq_users_open_id'))
    )
    op.create_table('developer_api_keys',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('key_prefix', sa.String(length=24), nullable=False),
    sa.Column('secret_hash', sa.String(length=64), nullable=False),
    sa.Column('scopes', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('status', sa.Enum('active', 'revoked', name='api_key_status'), server_default='active', nullable=False),
    sa.Column('rate_limit_per_minute', sa.Integer(), server_default='5', nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("secret_hash ~ '^[a-f0-9]{64}$'", name=op.f('ck_developer_api_keys_secret_hash_is_sha256')),
    sa.CheckConstraint('array_length(scopes, 1) >= 1', name=op.f('ck_developer_api_keys_scopes_not_empty')),
    sa.CheckConstraint('rate_limit_per_minute between 1 and 10000', name=op.f('ck_developer_api_keys_rate_limit_range')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_developer_api_keys_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_developer_api_keys')),
    sa.UniqueConstraint('key_prefix', name=op.f('uq_developer_api_keys_key_prefix')),
    sa.UniqueConstraint('secret_hash', name=op.f('uq_developer_api_keys_secret_hash'))
    )
    op.create_index('ix_developer_api_keys_scopes', 'developer_api_keys', ['scopes'], unique=False, postgresql_using='gin')
    op.create_index('ix_developer_api_keys_user_created', 'developer_api_keys', ['user_id', 'created_at'], unique=False)
    op.create_table('policies',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('source_preference', sa.Text(), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=False),
    sa.Column('action', sa.Enum('blur', 'block', 'warn', name='policy_action'), nullable=False),
    sa.Column('scope_text', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('scope_images', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('rules', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("jsonb_typeof(rules) = 'array'", name=op.f('ck_policies_rules_is_array')),
    sa.CheckConstraint('char_length(name) between 2 and 120', name=op.f('ck_policies_name_length')),
    sa.CheckConstraint('jsonb_array_length(rules) between 1 and 12', name=op.f('ck_policies_rules_count')),
    sa.CheckConstraint('version >= 1', name=op.f('ck_policies_version_positive')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_policies_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_policies'))
    )
    op.create_index('ix_policies_user_updated', 'policies', ['user_id', sa.literal_column('updated_at DESC')], unique=False)
    op.create_table('subscriptions',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('plan_code', sa.String(length=64), server_default='trial', nullable=False),
    sa.Column('status', sa.Enum('trial', 'active', 'expired', 'cancelled', name='subscription_status'), server_default='trial', nullable=False),
    sa.Column('trial_started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancel_at_period_end', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('stripe_customer_id', sa.String(length=255), nullable=True),
    sa.Column('stripe_subscription_id', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('(current_period_start IS NULL) = (current_period_end IS NULL)', name=op.f('ck_subscriptions_period_pair')),
    sa.CheckConstraint('current_period_end IS NULL OR current_period_end > current_period_start', name=op.f('ck_subscriptions_period_order')),
    sa.CheckConstraint('trial_ends_at > trial_started_at', name=op.f('ck_subscriptions_trial_window')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_subscriptions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscriptions')),
    sa.UniqueConstraint('user_id', name=op.f('uq_subscriptions_user_id'))
    )
    op.create_table('audit_log',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('request_id', sa.String(length=64), nullable=True),
    sa.Column('actor_type', sa.Enum('session_user', 'api_key', 'extension_token', 'system', name='audit_actor_type'), nullable=False),
    sa.Column('actor_user_id', sa.BigInteger(), nullable=True),
    sa.Column('actor_key_id', sa.BigInteger(), nullable=True),
    sa.Column('actor_label', sa.Text(), nullable=True),
    sa.Column('action', sa.Text(), nullable=False),
    sa.Column('target_type', sa.Text(), nullable=False),
    sa.Column('target_id', sa.Text(), nullable=True),
    sa.Column('ip', postgresql.INET(), nullable=True),
    sa.Column('user_agent', sa.Text(), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.CheckConstraint("(actor_type = 'session_user'    AND actor_user_id IS NOT NULL) OR (actor_type = 'extension_token' AND actor_user_id IS NOT NULL) OR (actor_type = 'api_key'         AND actor_key_id  IS NOT NULL) OR (actor_type = 'system'          AND actor_user_id IS NULL AND actor_key_id IS NULL)", name=op.f('ck_audit_log_actor_shape')),
    sa.ForeignKeyConstraint(['actor_key_id'], ['developer_api_keys.id'], name=op.f('fk_audit_log_actor_key_id_developer_api_keys'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], name=op.f('fk_audit_log_actor_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_log'))
    )
    op.create_index('ix_audit_log_actor_user', 'audit_log', ['actor_user_id', 'occurred_at'], unique=False)
    op.create_index('ix_audit_log_occurred', 'audit_log', ['occurred_at'], unique=False)
    op.create_index('ix_audit_log_target', 'audit_log', ['target_type', 'target_id', 'occurred_at'], unique=False)
    op.create_table('check_history',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('policy_id', sa.BigInteger(), nullable=True),
    sa.Column('input_type', sa.Enum('text', 'image', name='check_input_type'), nullable=False),
    sa.Column('input_value', sa.Text(), nullable=False),
    sa.Column('decision', sa.Enum('allow', 'blur', 'block', 'warn', 'uncertain', name='check_decision'), nullable=False),
    sa.Column('confidence', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(length=255), nullable=False),
    sa.Column('cache_status', sa.Enum('fresh', 'cached', name='cache_status'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('confidence between 0 and 100', name=op.f('ck_check_history_confidence_range')),
    sa.ForeignKeyConstraint(['policy_id'], ['policies.id'], name=op.f('fk_check_history_policy_id_policies'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_check_history_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_check_history'))
    )
    op.create_index('ix_check_history_user_created', 'check_history', ['user_id', 'created_at'], unique=False)
    op.create_table('developer_api_usage',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('api_key_id', sa.BigInteger(), nullable=False),
    sa.Column('item_count', sa.Integer(), nullable=False),
    sa.Column('match_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('no_match_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('unavailable_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('latency_ms', sa.Integer(), nullable=False),
    sa.Column('http_status', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('http_status between 100 and 599', name=op.f('ck_developer_api_usage_http_status_range')),
    sa.CheckConstraint('item_count >= 0', name=op.f('ck_developer_api_usage_item_count_positive')),
    sa.CheckConstraint('latency_ms between 0 and 600000', name=op.f('ck_developer_api_usage_latency_range')),
    sa.ForeignKeyConstraint(['api_key_id'], ['developer_api_keys.id'], name=op.f('fk_developer_api_usage_api_key_id_developer_api_keys'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_developer_api_usage')),
    comment='Aggregate counters only. Never store submitted text, policies, labels or model rationale in this table.'
    )
    op.create_index('ix_developer_api_usage_key_created', 'developer_api_usage', ['api_key_id', 'created_at'], unique=False)
    op.create_table('image_uploads',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('api_key_id', sa.BigInteger(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('mime_type', sa.String(length=40), nullable=False),
    sa.Column('byte_size', sa.Integer(), nullable=False),
    sa.Column('width', sa.Integer(), nullable=True),
    sa.Column('height', sa.Integer(), nullable=True),
    sa.Column('subject', sa.String(length=80), nullable=True),
    sa.Column('labels', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("sha256 ~ '^[a-f0-9]{64}$'", name=op.f('ck_image_uploads_sha256_is_digest')),
    sa.CheckConstraint('byte_size > 0', name=op.f('ck_image_uploads_byte_size_positive')),
    sa.ForeignKeyConstraint(['api_key_id'], ['developer_api_keys.id'], name=op.f('fk_image_uploads_api_key_id_developer_api_keys'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_image_uploads')),
    sa.UniqueConstraint('sha256', name=op.f('uq_image_uploads_sha256'))
    )
    op.create_index('ix_image_uploads_key_created', 'image_uploads', ['api_key_id', 'created_at'], unique=False)
    # ### end Alembic commands ###

    op.execute(SET_UPDATED_AT)
    for table in UPDATED_AT_TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_set_updated_at BEFORE UPDATE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
        )


def downgrade() -> None:
    for table in UPDATED_AT_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_set_updated_at ON {table}")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at()")

    for table in (
        "audit_log",
        "image_uploads",
        "developer_api_usage",
        "check_history",
        "policies",
        "developer_api_keys",
        "subscriptions",
        "users",
    ):
        op.drop_table(table)

    # Enums are not dropped by drop_table and would collide on a re-run.
    for enum in (
        "audit_actor_type",
        "cache_status",
        "check_decision",
        "check_input_type",
        "policy_action",
        "api_key_status",
        "subscription_status",
        "user_role",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum}")
