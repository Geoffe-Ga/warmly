"""Deletions that last, in PostgreSQL (PRD SYNC-005, OPS-003; AC-17).

A tombstone is final and every deletion is in an append-only ledger. Both
are the database's own guarantees, so they are tested against it.
"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
import pytest_asyncio

from tests.db.conftest import BROWSER_ROLES, throwaway_database
from warmly.db.database import Database
from warmly.db.migrate import apply_migrations, discover
from warmly.db.sync_store import PostgresSyncStore
from warmly.schemas.sync import SyncOperation

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
PAYLOAD = "b3BhcXVl"
TABLES = ("records", "owner_sequences", "operation_receipts", "deletion_ledger")
LEDGER = "SELECT record_id FROM warmly_private.deletion_ledger ORDER BY deleted_at"


def _op(record: UUID, base: int = 0, **changes: Any) -> SyncOperation:
    """Build an operation with a fresh ID."""
    fields: dict[str, Any] = {
        "op_id": uuid4(),
        "record_id": record,
        "type": 1,
        "base_revision": base,
        "schema_version": 1,
        "tombstone": False,
        "payload": PAYLOAD,
    }
    return SyncOperation.model_validate(fields | changes)


def _delete(record: UUID, base: int) -> SyncOperation:
    """Build an operation that deletes a record."""
    return _op(record, base, tombstone=True, payload=None)


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database and empty the sync tables."""
    database = Database(database_url, max_size=8)
    await database.open()
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "TRUNCATE " + ", ".join(f"warmly_private.{table}" for table in TABLES)
        )
    try:
        yield database
    finally:
        await database.close()


@pytest_asyncio.fixture
async def store(db: Database) -> PostgresSyncStore:
    """Return the store under test."""
    return PostgresSyncStore(db)


async def _rows(db: Database, owner: UUID, query: str) -> list[tuple[Any, ...]]:
    """Run a read as an owner and return every row."""
    async with db.as_owner(owner) as tx:
        cursor = await tx.execute(query)
        return await cursor.fetchall()


async def test_deleting_a_record_writes_the_ledger_and_nothing_else_does(
    db: Database, store: PostgresSyncStore
) -> None:
    """Creating and editing leave the ledger empty; the deletion adds one row."""
    record = uuid4()
    await store.apply(OWNER_A, _op(record))
    await store.apply(OWNER_A, _op(record, 1, payload="bmV3ZXI="))
    assert not await _rows(db, OWNER_A, LEDGER)

    result = await store.apply(OWNER_A, _delete(record, 2))

    assert result.status == "applied"
    assert await _rows(db, OWNER_A, LEDGER) == [(record,)]
    (when,) = await _rows(
        db, OWNER_A, "SELECT deleted_at IS NOT NULL FROM warmly_private.deletion_ledger"
    )
    assert when == (True,)


async def test_a_record_created_already_deleted_is_in_the_ledger(
    db: Database, store: PostgresSyncStore
) -> None:
    """A record made and deleted offline arrives as one tombstone."""
    record = uuid4()

    await store.apply(OWNER_A, _delete(record, 0))

    assert await _rows(db, OWNER_A, LEDGER) == [(record,)]


async def test_a_refused_deletion_writes_nothing_to_the_ledger(
    db: Database, store: PostgresSyncStore
) -> None:
    """A delete made on an out-of-date copy is a conflict, not a deletion."""
    record = uuid4()
    await store.apply(OWNER_A, _op(record))
    await store.apply(OWNER_A, _op(record, 1, payload="bmV3ZXI="))

    stale = await store.apply(OWNER_A, _delete(record, 1))

    assert (stale.status, stale.current_revision) == ("conflict", 2)
    assert not await _rows(db, OWNER_A, LEDGER)
    assert await _rows(
        db, OWNER_A, "SELECT tombstone, payload FROM warmly_private.records"
    ) == [(False, "bmV3ZXI=")]


async def test_nothing_sent_after_a_deletion_changes_the_record_or_the_ledger(
    db: Database, store: PostgresSyncStore
) -> None:
    """Edits, repeats and second deletions all get ``deleted`` (SYNC-005)."""
    record = uuid4()
    await store.apply(OWNER_A, _op(record))
    await store.apply(OWNER_A, _delete(record, 1))
    before = await _rows(db, OWNER_A, "SELECT * FROM warmly_private.records")
    ledger = await _rows(db, OWNER_A, "SELECT * FROM warmly_private.deletion_ledger")

    for late in (
        _op(record, 1),
        _op(record, 2),
        _op(record, 0),
        _op(record, 9),
        _delete(record, 2),
    ):
        result = await store.apply(OWNER_A, late)
        assert (result.status, result.current_revision) == ("deleted", 2)

    assert await _rows(db, OWNER_A, "SELECT * FROM warmly_private.records") == before
    assert (
        await _rows(db, OWNER_A, "SELECT * FROM warmly_private.deletion_ledger")
        == ledger
    )


async def test_an_edit_racing_a_deletion_never_leaves_a_live_record(
    db: Database, store: PostgresSyncStore
) -> None:
    """Whichever commits first, the other is refused; a deletion that wins stays."""
    for _ in range(10):
        record = uuid4()
        await store.apply(OWNER_A, _op(record))

        edit, delete = await asyncio.gather(
            store.apply(OWNER_A, _op(record, 1, payload="bmV3ZXI=")),
            store.apply(OWNER_A, _delete(record, 1)),
        )

        (row,) = await _rows(
            db,
            OWNER_A,
            "SELECT tombstone, payload FROM warmly_private.records"
            f" WHERE record_id = '{record}'",
        )
        ledger = await _rows(
            db,
            OWNER_A,
            "SELECT 1 FROM warmly_private.deletion_ledger"
            f" WHERE record_id = '{record}'",
        )
        if delete.status == "applied":
            assert edit.status == "deleted"
            assert row == (True, None)
            assert ledger == [(1,)]
        else:
            assert (edit.status, delete.status) == ("applied", "conflict")
            assert row == (False, "bmV3ZXI=")
            assert not ledger


@pytest.mark.parametrize(
    "change",
    [
        "revision = revision + 1, sequence = sequence + 1",
        "schema_version = 2, revision = revision + 1, sequence = sequence + 1",
        "etag = repeat('0', 64), revision = revision + 1, sequence = sequence + 1",
        "updated_at = now()",
    ],
)
async def test_the_database_refuses_any_change_to_a_tombstone(
    db: Database, store: PostgresSyncStore, change: str
) -> None:
    """A deleted record never changes, whatever code runs later."""
    record = uuid4()
    await store.apply(OWNER_A, _op(record))
    await store.apply(OWNER_A, _delete(record, 1))
    before = await _rows(db, OWNER_A, "SELECT * FROM warmly_private.records")

    # Whichever guard speaks first, the change is refused.
    with pytest.raises(
        psycopg.errors.CheckViolation,
        match=r"a deleted record never changes|one revision at a time",
    ):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(f"UPDATE warmly_private.records SET {change}")

    assert await _rows(db, OWNER_A, "SELECT * FROM warmly_private.records") == before


@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM warmly_private.deletion_ledger",
        "UPDATE warmly_private.deletion_ledger SET deleted_at = now()",
        "TRUNCATE warmly_private.deletion_ledger",
    ],
)
async def test_the_ledger_is_append_only(
    db: Database, store: PostgresSyncStore, statement: str
) -> None:
    """The API role can add to the ledger and read it, nothing more."""
    await store.apply(OWNER_A, _delete(uuid4(), 0))

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(statement)


async def test_an_account_sees_only_its_own_deletions_and_cannot_forge_anothers(
    db: Database, store: PostgresSyncStore
) -> None:
    """Row-level security covers the ledger like the records (SYNC-007)."""
    mine, theirs = uuid4(), uuid4()
    await store.apply(OWNER_A, _delete(mine, 0))
    await store.apply(OWNER_B, _delete(theirs, 0))

    assert await _rows(db, OWNER_A, LEDGER) == [(mine,)]
    assert await _rows(db, OWNER_B, LEDGER) == [(theirs,)]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_B) as tx:
            await tx.execute(
                "INSERT INTO warmly_private.deletion_ledger (owner_id, record_id)"
                " VALUES (%s, %s)",
                (OWNER_A, uuid4()),
            )


async def test_two_accounts_can_delete_records_with_the_same_id(
    db: Database, store: PostgresSyncStore
) -> None:
    """The ledger is keyed by account and record, like the records table."""
    record = uuid4()

    await store.apply(OWNER_A, _delete(record, 0))
    result = await store.apply(OWNER_B, _delete(record, 0))

    assert result.status == "applied"
    assert await _rows(db, OWNER_B, LEDGER) == [(record,)]


@pytest.mark.parametrize("role", BROWSER_ROLES)
async def test_browser_roles_cannot_read_the_ledger(
    database_url: str, role: str
) -> None:
    """Supabase's browser roles have no access to the deletion ledger."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(f"SET ROLE {role}")
        conn.execute("SELECT 1 FROM warmly_private.deletion_ledger")


async def test_deletions_made_before_the_ledger_existed_are_recorded_by_the_migration(
    admin_url: str,
) -> None:
    """A database that already holds tombstones gets a complete ledger."""
    migrations = discover()
    ledger = next(
        index for index, each in enumerate(migrations) if "deletion_ledger" in each.name
    )
    deleted, live = uuid4(), uuid4()
    with throwaway_database(admin_url) as url, psycopg.connect(url) as conn:
        apply_migrations(conn, migrations[:ledger])
        conn.execute(
            "INSERT INTO warmly_private.records (owner_id, record_id, type,"
            " schema_version, revision, sequence, tombstone, payload, etag,"
            " updated_at) VALUES"
            " (%(owner)s, %(deleted)s, 1, 1, 2, 2, true, NULL, %(etag)s,"
            "  '2026-11-01T00:00:00Z'),"
            " (%(owner)s, %(live)s, 1, 1, 1, 1, false, 'eA==', %(etag)s, now())",
            {"owner": OWNER_A, "deleted": deleted, "live": live, "etag": "0" * 64},
        )
        conn.commit()

        apply_migrations(conn, migrations)

        rows = conn.execute(
            "SELECT owner_id, record_id, deleted_at::date::text"
            " FROM warmly_private.deletion_ledger"
        ).fetchall()
    assert rows == [(OWNER_A, deleted, "2026-11-01")]
