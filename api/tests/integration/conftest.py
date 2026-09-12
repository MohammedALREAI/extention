"""Integration fixtures: a real PostgreSQL, or a clean skip.

Every test here runs inside a transaction that is rolled back afterwards, so the suite
leaves no rows behind and tests cannot see each other's data. That is faster than
truncating between tests and, more importantly, it means a failing test cannot poison the
next one.

The schema under test is the *migrated* one — ``alembic upgrade head`` — not
``create_all``. Those two can diverge, and when they do it is the migration that is wrong
and the migration that ships.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker, create_async_engine

API_ROOT = Path(__file__).resolve().parents[2]


def async_database_url() -> str | None:
    """The test database URL, preferring an explicit test one over the app's."""
    from dotenv import load_dotenv

    load_dotenv(API_ROOT.parent / ".env", override=False)
    url = os.getenv("CF_TEST_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        return None
    for prefix in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    url = async_database_url()
    if not url:
        pytest.skip("no DATABASE_URL or CF_TEST_DATABASE_URL; integration tests need PostgreSQL")
    yield url


@pytest.fixture(scope="session")
async def engine(database_url: str):
    engine = create_async_engine(database_url, poolclass=None)
    try:
        async with engine.connect() as connection:
            # Fail fast and clearly rather than letting every test report the same
            # connection error.
            await connection.execute(text("select 1"))
            applied = (
                await connection.execute(text("select version_num from alembic_version"))
            ).scalar()
        if applied is None:
            pytest.skip("database has no schema; run `alembic upgrade head` first")
    except Exception as error:
        pytest.skip(f"PostgreSQL is not reachable: {error}")
    yield engine
    await engine.dispose()


@pytest.fixture
async def connection(engine) -> AsyncIterator[AsyncConnection]:
    """A connection inside a transaction that is always rolled back."""
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            yield conn
        finally:
            await transaction.rollback()


@pytest.fixture
async def session(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    """A session bound to the rolled-back connection.

    ``join_transaction_mode="create_savepoint"`` lets the code under test commit normally
    — its commit becomes a savepoint release, and the outer rollback still discards
    everything. Without it, testing anything that commits would leak rows.
    """
    maker = async_sessionmaker(bind=connection, join_transaction_mode="create_savepoint")
    async with maker() as session:
        yield session
