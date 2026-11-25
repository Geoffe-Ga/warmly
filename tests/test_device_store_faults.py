"""What the device store does when the database fails, with no database.

``tests/db/test_device_store.py`` covers the store against PostgreSQL.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import psycopg
import pytest

from warmly.db.device_store import PostgresDeviceStore

pytestmark = pytest.mark.asyncio

OWNER = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
DEVICE = UUID("d0000000-0000-4000-8000-000000000001")


class _Recorder:
    """Stands in for a transaction and remembers what was run."""

    def __init__(self) -> None:
        self.statements: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, query: str, params: tuple[Any, ...]) -> None:
        """Remember a statement."""
        self.statements.append((query, params))


class _Database:
    """Hands out one transaction, or fails as an unreachable database does."""

    def __init__(self, *, broken: bool) -> None:
        self.broken = broken
        self.transaction = _Recorder()
        self.owners: list[UUID] = []

    @asynccontextmanager
    async def as_owner(self, owner_id: UUID) -> AsyncIterator[Any]:
        """Open a pretend transaction for an owner."""
        self.owners.append(owner_id)
        if self.broken:
            message = "synthetic: the database is unreachable"
            raise psycopg.OperationalError(message)
        yield self.transaction


async def test_marking_a_device_synced_runs_one_statement_as_its_owner() -> None:
    """The update names the device; row-level security supplies the owner."""
    database = _Database(broken=False)

    assert await PostgresDeviceStore(database).mark_synced(OWNER, DEVICE)

    assert database.owners == [OWNER]
    ((statement, params),) = database.transaction.statements
    assert params == (DEVICE,)
    assert "last_sync_at = now()" in statement
    # A revoked device is never marked, and a recent time is left alone.
    assert "revoked_at IS NULL" in statement
    assert "interval '5 minutes'" in statement


async def test_a_database_fault_is_reported_and_not_raised() -> None:
    """The caller has already read its page; this must not turn it into an error."""
    database = _Database(broken=True)

    assert not await PostgresDeviceStore(database).mark_synced(OWNER, DEVICE)
