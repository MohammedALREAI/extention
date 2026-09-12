"""Alembic environment.

Runs migrations synchronously even though the application is async: migrations are a
one-shot administrative task, they must not race, and psycopg's sync driver keeps this
script free of an event loop it has no other use for.
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from contentfirewall.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is not set; migrations have nothing to connect to.")
    # The application uses the asyncpg driver; Alembic uses the sync one. Same database,
    # different DBAPI, so the scheme is rewritten rather than duplicated in configuration.
    return url.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgres://", "postgresql://"
    )


def include_object(obj, name, type_, reflected, compare_to) -> bool:  # type: ignore[no-untyped-def]
    """Keep autogenerate from proposing to drop things it did not create."""
    return not (type_ == "table" and name in {"alembic_version"})


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = database_url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
