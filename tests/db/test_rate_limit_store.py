"""Request counters in PostgreSQL (PRD §8, SEC-005; AC-20).

The counters are shared by every copy of the API, so what matters is how the
database counts under concurrency and keeps accounts apart.
"""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
import pytest
import pytest_asyncio

from tests.db.conftest import BROWSER_ROLES
from warmly.db.database import Database
from warmly.db.rate_limit_store import PostgresRateLimitStore

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
WINDOW = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
NEXT = WINDOW + timedelta(minutes=1)
DEVICE = "device:d0000000-0000-4000-8000-000000000001"
CALLERS = 25


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database and empty the counters."""
    database = Database(database_url, max_size=10)
    await database.open()
    with psycopg.connect(database_url) as conn:
        conn.execute("TRUNCATE warmly_private.rate_limits")
    try:
        yield database
    finally:
        await database.close()


@pytest_asyncio.fixture
async def store(db: Database) -> PostgresRateLimitStore:
    """Return the store under test."""
    return PostgresRateLimitStore(db)


async def _rows(db: Database, owner: UUID) -> list[tuple[Any, ...]]:
    """Return an owner's counters."""
    async with db.as_owner(owner) as tx:
        cursor = await tx.execute(
            "SELECT scope, window_start, count FROM warmly_private.rate_limits"
            " ORDER BY scope"
        )
        return await cursor.fetchall()


async def test_each_request_adds_one_to_every_scope_it_names(
    db: Database, store: PostgresRateLimitStore
) -> None:
    """The totals come back in the order the scopes were given."""
    assert await store.count(OWNER_A, ("account", DEVICE), WINDOW) == (1, 1)
    assert await store.count(OWNER_A, ("account",), WINDOW) == (2,)
    assert await store.count(OWNER_A, ("account", DEVICE), WINDOW) == (3, 2)

    assert await _rows(db, OWNER_A) == [("account", WINDOW, 3), (DEVICE, WINDOW, 2)]


async def test_a_new_window_starts_the_count_again_and_forgets_the_old_one(
    db: Database, store: PostgresRateLimitStore
) -> None:
    """Counters from a window that has ended are removed, not kept."""
    await store.count(OWNER_A, ("account", DEVICE), WINDOW)
    await store.count(OWNER_A, ("account", DEVICE), WINDOW)

    assert await store.count(OWNER_A, ("account",), NEXT) == (1,)

    # The device made no request in the new window, so it has no row.
    assert await _rows(db, OWNER_A) == [("account", NEXT, 1)]


async def test_requests_at_the_same_moment_are_all_counted(
    db: Database, store: PostgresRateLimitStore
) -> None:
    """No request slips through uncounted, however many arrive together."""
    totals = await asyncio.gather(
        *(store.count(OWNER_A, ("account", DEVICE), WINDOW) for _ in range(CALLERS))
    )

    expected = list(range(1, CALLERS + 1))
    assert sorted(total[0] for total in totals) == expected
    assert sorted(total[1] for total in totals) == expected
    assert await _rows(db, OWNER_A) == [
        ("account", WINDOW, CALLERS),
        (DEVICE, WINDOW, CALLERS),
    ]


async def test_requests_either_side_of_a_window_boundary_do_not_mix(
    db: Database, store: PostgresRateLimitStore
) -> None:
    """A late request from the old window cannot add to the new one's count."""
    await store.count(OWNER_A, ("account",), WINDOW)

    totals = await asyncio.gather(
        *(
            store.count(OWNER_A, ("account",), NEXT if n % 2 else WINDOW)
            for n in range(CALLERS)
        )
    )

    # The counter ends in the new window, holding exactly the requests made
    # in it. Late requests from the old window did not add to it or reset it.
    assert totals
    assert await _rows(db, OWNER_A) == [("account", NEXT, CALLERS // 2)]


async def test_an_account_counts_only_against_itself(
    db: Database, store: PostgresRateLimitStore
) -> None:
    """One account's requests never use up another's allowance (SEC-005)."""
    for _ in range(4):
        await store.count(OWNER_A, ("account", DEVICE), WINDOW)

    assert await store.count(OWNER_B, ("account", DEVICE), WINDOW) == (1, 1)

    assert await _rows(db, OWNER_A) == [("account", WINDOW, 4), (DEVICE, WINDOW, 4)]
    assert await _rows(db, OWNER_B) == [("account", WINDOW, 1), (DEVICE, WINDOW, 1)]


async def test_an_account_cannot_write_or_clear_anothers_counters(
    db: Database, store: PostgresRateLimitStore
) -> None:
    """Row-level security covers the counters like everything else."""
    await store.count(OWNER_A, ("account",), WINDOW)

    async with db.as_owner(OWNER_B) as tx:
        cleared = await tx.execute("DELETE FROM warmly_private.rate_limits")
        assert cleared.rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_B) as tx:
            await tx.execute(
                "INSERT INTO warmly_private.rate_limits"
                " (owner_id, scope, window_start, count) VALUES (%s, 'x', now(), 1)",
                (OWNER_A,),
            )

    assert await _rows(db, OWNER_A) == [("account", WINDOW, 1)]


async def test_naming_many_devices_leaves_only_the_current_windows_rows(
    db: Database, store: PostgresRateLimitStore
) -> None:
    """An account cannot grow the table without bound by inventing devices."""
    for n in range(30):
        scope = f"device:d0000000-0000-4000-8000-{n:012d}"
        await store.count(OWNER_A, ("account", scope), WINDOW)

    await store.count(OWNER_A, ("account",), NEXT)

    assert await _rows(db, OWNER_A) == [("account", NEXT, 1)]


@pytest.mark.parametrize("role", BROWSER_ROLES)
async def test_browser_roles_cannot_read_the_counters(
    database_url: str, role: str
) -> None:
    """Supabase's browser roles have no access to the counters."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(f"SET ROLE {role}")
        conn.execute("SELECT 1 FROM warmly_private.rate_limits")
