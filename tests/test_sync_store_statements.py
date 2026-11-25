"""Which statements the sync store runs, with no database (ADR-0006).

``tests/db/test_sync_store.py`` proves the behaviour against PostgreSQL.
These tests pin the order that behaviour depends on: the account's lock is
taken before anything is read, and a repeated or refused operation runs no
statement that writes.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import pytest

from warmly.db import sync_store
from warmly.db.sync_store import PostgresSyncStore, etag_of
from warmly.schemas.sync import SyncOperation

pytestmark = pytest.mark.asyncio

OWNER = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
RECORD = UUID("11111111-1111-4111-8111-111111111111")
OP = UUID("22222222-2222-4222-8222-222222222222")
PAYLOAD = "b3BhcXVl"

NAMES = {
    sync_store._LOCK_OWNER: "lock",
    sync_store._READ_RECEIPT: "read receipt",
    sync_store._READ_RECORD: "read record",
    sync_store._NEXT_SEQUENCE: "next sequence",
    sync_store._CREATE_RECORD: "create",
    sync_store._REPLACE_RECORD: "replace",
    sync_store._WRITE_RECEIPT: "write receipt",
    sync_store._READ_LAST_SEQUENCE: "last sequence",
    sync_store._READ_CHANGES: "read changes",
}
WRITES = {"next sequence", "create", "replace", "write receipt"}


class _Cursor:
    """A cursor holding at most one row."""

    def __init__(self, row: tuple[Any, ...] | None, rowcount: int = 1) -> None:
        self._row = row
        self.rowcount = rowcount

    async def fetchone(self) -> tuple[Any, ...] | None:
        """Return the row."""
        return self._row

    async def fetchall(self) -> list[tuple[Any, ...]]:
        """Return the rows of a query that was scripted with a list."""
        return list(self._row or ())


class _Database:
    """Records each statement and answers reads from a script."""

    def __init__(self, **rows: tuple[Any, ...] | None) -> None:
        self._rows: dict[str, tuple[Any, ...] | None] = {"next sequence": (7,)}
        self._rows |= {name.replace("_", " "): row for name, row in rows.items()}
        self.owners: list[UUID] = []
        # How many rows a statement reports it changed, if not one.
        self.rowcounts: dict[str, int] = {}
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, query: str, params: tuple[Any, ...]) -> _Cursor:
        """Record a statement and return its scripted row."""
        name = NAMES[query]
        self.calls.append((name, params))
        return _Cursor(self._rows.get(name), self.rowcounts.get(name, 1))

    @asynccontextmanager
    async def as_owner(self, owner_id: UUID) -> AsyncIterator[Any]:
        """Open a pretend transaction for an owner."""
        self.owners.append(owner_id)
        yield self

    @property
    def names(self) -> list[str]:
        """Return the statements run, in order."""
        return [name for name, _ in self.calls]

    def params(self, name: str) -> tuple[Any, ...]:
        """Return the parameters of the one statement with this name."""
        (found,) = (params for call, params in self.calls if call == name)
        return found


def _op(base: int = 0, **changes: Any) -> SyncOperation:
    """Build an operation."""
    fields: dict[str, Any] = {
        "op_id": OP,
        "record_id": RECORD,
        "type": 1,
        "base_revision": base,
        "schema_version": 3,
        "tombstone": False,
        "payload": PAYLOAD,
    }
    return SyncOperation.model_validate(fields | changes)


async def test_a_new_record_takes_the_lock_first_and_writes_everything_once() -> None:
    """One transaction for the owner: lock, read, then the three writes."""
    database = _Database()

    result = await PostgresSyncStore(database).apply(OWNER, _op())

    assert (result.status, result.revision) == ("applied", 1)
    assert database.owners == [OWNER]
    assert database.names == [
        "lock",
        "read receipt",
        "read record",
        "next sequence",
        "create",
        "write receipt",
    ]
    assert database.params("lock") == (OWNER,)
    assert database.params("create") == (
        OWNER,
        RECORD,
        1,
        3,
        7,
        False,
        PAYLOAD,
        etag_of(PAYLOAD),
    )
    assert database.params("write receipt") == (OWNER, OP, RECORD, 1)


async def test_an_update_swaps_only_at_the_base_revision_it_was_made_on() -> None:
    """The base revision is the last parameter: the statement's WHERE clause."""
    database = _Database(read_record=(1, 4, False))

    result = await PostgresSyncStore(database).apply(OWNER, _op(4))

    assert (result.status, result.revision) == ("applied", 5)
    assert database.names[-3:] == ["next sequence", "replace", "write receipt"]
    assert database.params("replace") == (
        3,
        7,
        False,
        PAYLOAD,
        etag_of(PAYLOAD),
        OWNER,
        RECORD,
        4,
    )
    assert database.params("write receipt") == (OWNER, OP, RECORD, 5)


async def test_a_deletion_stores_no_payload() -> None:
    """A tombstone replaces the ciphertext with nothing."""
    database = _Database(read_record=(1, 2, False))

    await PostgresSyncStore(database).apply(OWNER, _op(2, tombstone=True, payload=None))

    assert database.params("replace")[2:5] == (True, None, etag_of(None))


async def test_a_repeated_operation_reads_its_receipt_and_writes_nothing() -> None:
    """The receipt answers; the record is not even read."""
    database = _Database(read_receipt=(6,), read_record=(1, 9, False))

    result = await PostgresSyncStore(database).apply(OWNER, _op(5))

    assert (result.status, result.revision) == ("duplicate", 6)
    assert database.names == ["lock", "read receipt"]


@pytest.mark.parametrize(
    ("stored", "base", "status"),
    [
        ((1, 3, False), 2, "conflict"),
        ((1, 3, False), 0, "conflict"),
        ((1, 3, True), 3, "deleted"),
        (None, 2, "rejected"),
        ((9, 3, False), 3, "rejected"),
    ],
)
async def test_a_refused_operation_runs_no_statement_that_writes(
    stored: tuple[int, int, bool] | None, base: int, status: str
) -> None:
    """No sequence number is used up and no receipt is kept."""
    database = _Database(read_record=stored)

    result = await PostgresSyncStore(database).apply(OWNER, _op(base))

    assert result.status == status
    assert WRITES.isdisjoint(database.names)
    assert database.names == ["lock", "read receipt", "read record"]


def _row(sequence: int, candidates: int) -> tuple[Any, ...]:
    """Build a feed row as the query returns it."""
    return (RECORD, 1, 1, sequence, 1, False, etag_of(PAYLOAD), PAYLOAD, candidates)


async def test_the_feed_asks_for_one_record_more_than_a_page_holds() -> None:
    """The extra record is how the store knows whether there is more."""
    rows = [_row(5, 3), _row(6, 3), _row(8, 3)]
    database = _Database(last_sequence=(9,), read_changes=tuple(rows))
    store = PostgresSyncStore(database, page_size=2, page_characters=50)

    page = await store.changes(OWNER, 4)

    assert database.owners == [OWNER]
    assert database.names == ["last sequence", "read changes"]
    assert database.params("read changes") == (OWNER, 4, 3, 50)
    assert page is not None
    assert [change.sequence for change in page.changes] == [5, 6]
    assert (page.next_cursor, page.has_more) == ("6", True)


async def test_the_feed_has_more_when_the_size_mark_cut_the_page_short() -> None:
    """Fewer rows came back than the query found: the rest is still to come."""
    database = _Database(last_sequence=(9,), read_changes=(_row(5, 3),))

    page = await PostgresSyncStore(database).changes(OWNER, 4)

    assert page is not None
    assert (page.next_cursor, page.has_more) == ("5", True)


async def test_an_empty_page_keeps_the_cursor() -> None:
    """Nothing new: the device stays where it is."""
    database = _Database(last_sequence=(4,), read_changes=())

    page = await PostgresSyncStore(database).changes(OWNER, 4)

    assert page is not None
    assert (page.changes, page.next_cursor, page.has_more) == ([], "4", False)


@pytest.mark.parametrize("last", [None, (3,)])
async def test_a_cursor_that_was_never_given_reads_no_records(
    last: tuple[int] | None,
) -> None:
    """The store stops before the feed query."""
    database = _Database(last_sequence=last)

    assert await PostgresSyncStore(database).changes(OWNER, 4) is None
    assert database.names == ["last sequence"]


async def test_an_update_that_changes_no_row_fails_loudly() -> None:
    """A device is never told its change was stored when it was not."""
    database = _Database(read_record=(1, 4, False))
    database.rowcounts["replace"] = 0

    with pytest.raises(sync_store.SyncInvariantError):
        await PostgresSyncStore(database).apply(OWNER, _op(4))

    # It stopped before the receipt, and the error ends the transaction.
    assert database.names[-1] == "replace"
    assert "write receipt" not in database.names
