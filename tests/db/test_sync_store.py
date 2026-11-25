"""Synced records in PostgreSQL (PRD SYNC-003, SYNC-008; AC-04, AC-05, AC-16).

Run against a real PostgreSQL, because the guarantees here are the
database's: one winner among concurrent writers, a repeated operation that
changes nothing, and row-level security between accounts. The scenario table
is the same one the client's in-memory server passes (ADR-0006).
"""

import asyncio
import hashlib
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
import pytest_asyncio

from tests.db.conftest import BROWSER_ROLES
from tests.sync_scenarios import SCENARIO_IDS, SCENARIOS, expected, wire
from warmly.db.database import Database
from warmly.db.sync_store import PostgresSyncStore, etag_of
from warmly.schemas.sync import OperationResult, SyncOperation

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
RECORD = UUID("11111111-1111-4111-8111-111111111111")
PAYLOAD = "b3BhcXVl"
NEWER = "bmV3ZXI="
TABLES = ("records", "owner_sequences", "operation_receipts")
WRITERS = 20


def _op(base: int = 0, **changes: Any) -> SyncOperation:
    """Build an operation with a fresh ID."""
    fields: dict[str, Any] = {
        "op_id": uuid4(),
        "record_id": RECORD,
        "type": 1,
        "base_revision": base,
        "schema_version": 1,
        "tombstone": False,
        "payload": PAYLOAD,
    }
    return SyncOperation.model_validate(fields | changes)


def _delete(base: int, **changes: Any) -> SyncOperation:
    """Build an operation that deletes the record."""
    return _op(base, tombstone=True, payload=None, **changes)


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database and empty the sync tables."""
    database = Database(database_url, max_size=WRITERS)
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


async def _record(db: Database, owner: UUID = OWNER_A) -> tuple[Any, ...] | None:
    """Return the owner's stored record, if any."""
    rows = await _rows(
        db,
        owner,
        "SELECT type, schema_version, revision, sequence, tombstone, payload, etag"
        " FROM warmly_private.records",
    )
    return rows[0] if rows else None


@pytest.mark.parametrize(("name", "steps"), SCENARIOS, ids=SCENARIO_IDS)
async def test_the_store_follows_the_adr_0006_scenario_table(
    store: PostgresSyncStore, name: str, steps: list[dict[str, Any]]
) -> None:
    """Each scenario gets the statuses the protocol defines, step by step."""
    for step in steps:
        operation = SyncOperation.model_validate(wire(step["operation"]))

        result = await store.apply(OWNER_A, operation)

        assert result.model_dump(mode="json") == expected(step), name


async def test_a_new_record_is_stored_as_sent_with_revision_and_sequence_one(
    db: Database, store: PostgresSyncStore
) -> None:
    """The payload text is kept exactly; nothing decodes it."""
    result = await store.apply(OWNER_A, _op())

    assert result.status == "applied"
    assert result.revision == 1
    assert await _record(db) == (
        1,
        1,
        1,
        1,
        False,
        PAYLOAD,
        hashlib.sha256(PAYLOAD.encode()).hexdigest(),
    )


async def test_an_update_replaces_the_payload_and_moves_revision_and_sequence_on(
    db: Database, store: PostgresSyncStore
) -> None:
    """Each accepted change takes the next revision and the next sequence."""
    await store.apply(OWNER_A, _op())
    other = uuid4()
    await store.apply(OWNER_A, _op(record_id=other))

    result = await store.apply(OWNER_A, _op(1, payload=NEWER, schema_version=2))

    assert result.revision == 2
    rows = await _rows(
        db,
        OWNER_A,
        "SELECT record_id, revision, sequence, payload, schema_version, etag"
        " FROM warmly_private.records ORDER BY sequence",
    )
    assert rows == [
        (other, 1, 2, PAYLOAD, 1, etag_of(PAYLOAD)),
        (RECORD, 2, 3, NEWER, 2, etag_of(NEWER)),
    ]


async def test_a_deleted_record_keeps_its_row_and_loses_its_ciphertext(
    db: Database, store: PostgresSyncStore
) -> None:
    """A tombstone is a row with no payload, at the next revision."""
    await store.apply(OWNER_A, _op())

    result = await store.apply(OWNER_A, _delete(1))

    assert result.status == "applied"
    assert await _record(db) == (1, 1, 2, 2, True, None, etag_of(None))


async def test_a_refused_operation_stores_nothing_at_all(
    db: Database, store: PostgresSyncStore
) -> None:
    """A stale change leaves the record, the receipts and the sequence alone."""
    await store.apply(OWNER_A, _op())
    await store.apply(OWNER_A, _op(1, payload=NEWER))
    before = await _record(db)

    stale = await store.apply(OWNER_A, _op(1, payload="c3RhbGU="))
    unknown = await store.apply(OWNER_A, _op(4, record_id=uuid4()))
    wrong_type = await store.apply(OWNER_A, _op(2, type=9))

    assert (stale.status, stale.current_revision) == ("conflict", 2)
    assert unknown.status == "rejected"
    assert wrong_type.status == "rejected"
    assert await _record(db) == before
    assert await _rows(
        db, OWNER_A, "SELECT count(*) FROM warmly_private.operation_receipts"
    ) == [(2,)]
    assert await _rows(
        db, OWNER_A, "SELECT last_sequence FROM warmly_private.owner_sequences"
    ) == [(2,)]


async def test_a_repeated_operation_returns_its_revision_and_changes_nothing(
    db: Database, store: PostgresSyncStore
) -> None:
    """A retry is a no-op, even after the record has moved on (SYNC-008)."""
    create = _op()
    await store.apply(OWNER_A, create)
    await store.apply(OWNER_A, _op(1, payload=NEWER))
    before = await _record(db)

    again = await store.apply(OWNER_A, create)

    assert again == OperationResult(op_id=create.op_id, status="duplicate", revision=1)
    assert await _record(db) == before


async def test_many_writers_from_one_base_revision_yield_exactly_one_winner(
    db: Database, store: PostgresSyncStore
) -> None:
    """Compare-and-swap: one applied, the rest conflicts, nothing lost (AC-04)."""
    await store.apply(OWNER_A, _op())
    attempts = [_op(1, payload=NEWER) for _ in range(WRITERS)]

    results = await asyncio.gather(*(store.apply(OWNER_A, op) for op in attempts))

    statuses = [result.status for result in results]
    assert statuses.count("applied") == 1
    assert statuses.count("conflict") == WRITERS - 1
    assert {r.current_revision for r in results if r.status == "conflict"} == {2}
    assert (await _record(db) or ())[2:4] == (2, 2)
    assert await _rows(
        db, OWNER_A, "SELECT count(*) FROM warmly_private.operation_receipts"
    ) == [(2,)]


async def test_many_writers_creating_one_record_yield_exactly_one_winner(
    db: Database, store: PostgresSyncStore
) -> None:
    """Two devices that both think a record is new cannot both create it."""
    attempts = [_op() for _ in range(WRITERS)]

    results = await asyncio.gather(*(store.apply(OWNER_A, op) for op in attempts))

    statuses = [result.status for result in results]
    assert statuses.count("applied") == 1
    assert statuses.count("conflict") == WRITERS - 1
    assert (await _record(db) or ())[2:4] == (1, 1)


async def test_one_operation_sent_many_times_at_once_is_applied_once(
    db: Database, store: PostgresSyncStore
) -> None:
    """A retry racing the original is still a no-op (SYNC-008)."""
    create = _op()

    results = await asyncio.gather(
        *(store.apply(OWNER_A, create) for _ in range(WRITERS))
    )

    statuses = [result.status for result in results]
    assert statuses.count("applied") == 1
    assert statuses.count("duplicate") == WRITERS - 1
    assert {result.revision for result in results} == {1}
    assert (await _record(db) or ())[2:4] == (1, 1)


async def test_writers_to_different_records_all_succeed_with_distinct_sequences(
    db: Database, store: PostgresSyncStore
) -> None:
    """An account's changes each get their own place in the feed."""
    attempts = [_op(record_id=uuid4()) for _ in range(WRITERS)]

    results = await asyncio.gather(*(store.apply(OWNER_A, op) for op in attempts))

    assert {result.status for result in results} == {"applied"}
    sequences = await _rows(
        db, OWNER_A, "SELECT sequence FROM warmly_private.records ORDER BY sequence"
    )
    assert sequences == [(n,) for n in range(1, WRITERS + 1)]


async def test_two_accounts_can_use_the_same_record_id_and_never_meet(
    db: Database, store: PostgresSyncStore
) -> None:
    """Another account's record is a different row, and cannot be detected."""
    mine = _op()
    await store.apply(OWNER_A, mine)
    await store.apply(OWNER_A, _op(1, payload=NEWER))

    # B knows A's record ID and A's operation ID. Neither means anything.
    guess = await store.apply(OWNER_B, _op(2, payload="c3RvbGVu"))
    replay = await store.apply(OWNER_B, mine)

    assert guess.status == "rejected"
    assert guess.current_revision is None
    assert (replay.status, replay.revision) == ("applied", 1)
    assert (await _record(db, OWNER_A) or ())[2:6] == (2, 2, False, NEWER)
    assert (await _record(db, OWNER_B) or ())[2:6] == (1, 1, False, PAYLOAD)


async def test_an_account_sees_only_its_own_rows_in_every_sync_table(
    db: Database, store: PostgresSyncStore
) -> None:
    """Row-level security hides another account's rows, whatever the SQL."""
    await store.apply(OWNER_A, _op())

    for table in TABLES:
        query = f"SELECT count(*) FROM warmly_private.{table}"
        assert await _rows(db, OWNER_A, query) == [(1,)]
        assert await _rows(db, OWNER_B, query) == [(0,)]


async def test_an_account_cannot_change_or_claim_another_accounts_record(
    db: Database, store: PostgresSyncStore
) -> None:
    """Updates aimed at another account's row touch nothing; inserts are refused."""
    await store.apply(OWNER_A, _op())

    async with db.as_owner(OWNER_B) as tx:
        cursor = await tx.execute(
            "UPDATE warmly_private.records SET payload = 'c3RvbGVu',"
            " revision = revision + 1, sequence = sequence + 1"
        )
        assert cursor.rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_B) as tx:
            await tx.execute(
                "INSERT INTO warmly_private.records (owner_id, record_id, type,"
                " schema_version, revision, sequence, tombstone, payload, etag)"
                " VALUES (%s, %s, 1, 1, 1, 9, false, 'eA==', %s)",
                (OWNER_A, uuid4(), "0" * 64),
            )

    assert (await _record(db, OWNER_A) or ())[5] == PAYLOAD


@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM warmly_private.records",
        "DELETE FROM warmly_private.operation_receipts",
        "UPDATE warmly_private.operation_receipts SET revision = 9",
        "DELETE FROM warmly_private.owner_sequences",
        "TRUNCATE warmly_private.records",
    ],
)
async def test_the_api_role_cannot_remove_records_or_rewrite_receipts(
    db: Database, store: PostgresSyncStore, statement: str
) -> None:
    """Records are never removed and receipts are append-only."""
    await store.apply(OWNER_A, _op())

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(statement)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (
            "tombstone = false, payload = 'eA==', revision = revision + 1,"
            " sequence = sequence + 1",
            "a deleted record stays deleted",
        ),
    ],
)
async def test_the_database_itself_keeps_a_deleted_record_deleted(
    db: Database, store: PostgresSyncStore, change: str, message: str
) -> None:
    """Whatever code runs later, a tombstone cannot become a live record."""
    await store.apply(OWNER_A, _op())
    await store.apply(OWNER_A, _delete(1))

    with pytest.raises(psycopg.errors.CheckViolation, match=message):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(f"UPDATE warmly_private.records SET {change}")

    assert (await _record(db) or ())[4:6] == (True, None)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (
            "type = 2, revision = revision + 1, sequence = sequence + 1",
            "a record keeps its type",
        ),
        ("revision = revision + 2, sequence = sequence + 1", "one revision at a time"),
        ("revision = revision, sequence = sequence + 1", "one revision at a time"),
        ("revision = revision + 1", "one revision at a time"),
        ("revision = revision + 1, sequence = sequence - 1", "one revision at a time"),
    ],
)
async def test_the_database_itself_keeps_a_records_history_in_order(
    db: Database, store: PostgresSyncStore, change: str, message: str
) -> None:
    """A record keeps its type, and its revision and sequence only move forward."""
    await store.apply(OWNER_A, _op())
    await store.apply(OWNER_A, _op(record_id=uuid4()))
    before = await _record(db)

    with pytest.raises(psycopg.errors.CheckViolation, match=message):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(
                f"UPDATE warmly_private.records SET {change} WHERE record_id = %s",
                (RECORD,),
            )

    assert (
        await _rows(
            db,
            OWNER_A,
            "SELECT type, schema_version, revision, sequence, tombstone, payload, etag"
            f" FROM warmly_private.records WHERE record_id = '{RECORD}'",
        )
    )[0] == before


async def test_a_row_cannot_be_live_without_ciphertext_or_deleted_with_it(
    db: Database, store: PostgresSyncStore
) -> None:
    """The table refuses a tombstone with a payload and a record without one."""
    await store.apply(OWNER_A, _op())

    for change in ("payload = NULL", "tombstone = true"):
        with pytest.raises(psycopg.errors.CheckViolation):
            async with db.as_owner(OWNER_A) as tx:
                await tx.execute(
                    f"UPDATE warmly_private.records SET {change},"
                    " revision = revision + 1, sequence = sequence + 1"
                )


@pytest.mark.parametrize("table", TABLES)
@pytest.mark.parametrize("role", BROWSER_ROLES)
async def test_browser_roles_cannot_read_the_sync_tables(
    database_url: str, table: str, role: str
) -> None:
    """Supabase's browser roles have no access to synced records."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(f"SET ROLE {role}")
        conn.execute(f"SELECT 1 FROM warmly_private.{table}")


async def test_the_etag_is_a_hash_of_the_payload_text() -> None:
    """The ETag comes from the text as sent, with no decoding."""
    assert etag_of(PAYLOAD) == hashlib.sha256(b"b3BhcXVl").hexdigest()
    assert etag_of(None) == hashlib.sha256(b"").hexdigest()
    assert etag_of(PAYLOAD) != etag_of(NEWER)
