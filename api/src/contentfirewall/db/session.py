"""Engine, sessions, and the unit-of-work boundary.

One session per request, committed on success and rolled back on failure. That is the
whole transaction story for ordinary handlers — with one deliberate exception.

**Writes that must survive a failed request open their own session.** A usage ledger row is
a billing record: if the request then 502s, a request-scoped rollback would erase the
evidence that the work was done and paid for. Same for audit rows describing something that
did happen before the failure. ``independent_session`` exists for exactly those, and
nothing else should use it.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


def normalise_url(url: str) -> str:
    """Accept any Postgres URL spelling and return the asyncpg one."""
    for prefix in ("postgresql+asyncpg://", "postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


def create_engine(url: str, *, pooled: bool = True) -> AsyncEngine:
    """One engine per process.

    Sizing is deliberately small: 10 connections per app container, so four replicas plus a
    worker stay well inside a default ``max_connections`` of 100 with room left for psql,
    migrations and monitoring. Running out of database connections is a much worse outage
    than queueing briefly for one.

    ``jit=off`` because the usage aggregate is exactly the shape where PostgreSQL's JIT
    spends longer compiling the plan than the query takes to run.
    """
    return create_async_engine(
        normalise_url(url),
        poolclass=NullPool if not pooled else None,
        pool_size=5 if pooled else None,  # type: ignore[arg-type]
        max_overflow=5 if pooled else None,  # type: ignore[arg-type]
        pool_pre_ping=pooled,
        pool_recycle=1800 if pooled else -1,
        connect_args={
            "server_settings": {"application_name": "content-firewall-api", "jit": "off"}
        },
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        bind=engine,
        expire_on_commit=False,  # a returned object stays readable after the commit
        autoflush=False,  # flushes happen where the code says so, not incidentally
    )


@asynccontextmanager
async def unit_of_work(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """One transaction for one request: commit on success, roll back on any exception."""
    async with factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()


@asynccontextmanager
async def independent_session(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """A short transaction that survives the request's own failure.

    Only for records of things that really happened regardless of the outcome — the usage
    ledger and audit rows. Using it for ordinary work would silently opt that work out of
    the request's atomicity.
    """
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
