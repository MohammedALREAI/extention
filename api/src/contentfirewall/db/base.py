"""Declarative base and the naming convention every constraint inherits.

The convention matters more than it looks: without it Alembic generates anonymous names
for indexes and constraints, and a later migration that wants to drop one has nothing
stable to name. Setting it once, before the first table exists, is the only cheap moment.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, MetaData, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utc_now_column(**kwargs: object) -> Mapped[datetime]:
    """A ``timestamptz`` defaulting to the database's clock.

    Timezone-aware throughout. The previous schema used naive ``timestamp``, which silently
    depends on the server's TimeZone setting — a latent correctness bug anywhere dates are
    compared, and subscription expiry is exactly that.

    The default is ``now()`` server-side rather than a Python value, so a row's timestamp
    comes from one clock no matter which process wrote it.
    """
    return mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        nullable=False,
        **kwargs,  # type: ignore[arg-type]
    )
