"""The change feed in PostgreSQL (PRD SYNC-002, SYNC-003; AC-05).

The feed's promise is that a device which follows its cursor sees every
change. That depends on how the database commits concurrent writes, so it is
proved here against a real PostgreSQL.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
import pytest_asyncio
from psycopg import AsyncConnection
from psycopg.rows import TupleRow

from warmly.db.database import Database
from warmly.db.sync_store import PostgresSyncStore, etag_of
from warmly.schemas.sync import Change, SyncOperation

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
PAYLOAD = "b3BhcXVl"
TABLES = ("records", "owner_sequences", "operation_receipts")
WRITERS = 8
CHANGES_EACH = 12


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


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database and empty the sync tables."""
    database = Database(database_url, max_size=WRITERS + 2)
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


async def _create(
    store: PostgresSyncStore, count: int, owner: UUID = OWNER_A
) -> list[UUID]:
    """Create ``count`` records, one after another, and return their IDs."""
    records = [uuid4() for _ in range(count)]
    for record in records:
        result = await store.apply(owner, _op(record))
        assert result.status == "applied"
    return records


def _places(changes: list[Change]) -> list[tuple[UUID, int, int]]:
    """Return each change's record, revision and sequence."""
    return [(change.record_id, change.revision, change.sequence) for change in changes]


async def _page(store: PostgresSyncStore, after: int, owner: UUID = OWNER_A) -> Any:
    """Return a page that must exist."""
    page = await store.changes(owner, after)
    assert page is not None
    return page


async def test_an_account_that_never_wrote_has_an_empty_feed(
    store: PostgresSyncStore,
) -> None:
    """Cursor 0 is always valid, even before the account's first change."""
    page = await _page(store, 0)

    assert (page.changes, page.next_cursor, page.has_more) == ([], "0", False)


async def test_the_feed_returns_each_record_as_it_is_now_in_sequence_order(
    store: PostgresSyncStore,
) -> None:
    """A record changed twice appears once, at its latest place."""
    first, second = await _create(store, 2)
    await store.apply(OWNER_A, _op(first, 1, payload="bmV3ZXI=", schema_version=2))

    page = await _page(store, 0)

    assert _places(page.changes) == [(second, 1, 2), (first, 2, 3)]
    assert page.changes[1] == Change(
        record_id=first,
        type=1,
        revision=2,
        sequence=3,
        schema_version=2,
        tombstone=False,
        etag=etag_of("bmV3ZXI="),
        payload="bmV3ZXI=",
    )
    assert (page.next_cursor, page.has_more) == ("3", False)


async def test_a_tombstone_is_in_the_feed_with_no_payload(
    store: PostgresSyncStore,
) -> None:
    """A deletion reaches other devices as a record like any other."""
    (record,) = await _create(store, 1)
    await store.apply(OWNER_A, _op(record, 1, tombstone=True, payload=None))

    (change,) = (await _page(store, 0)).changes

    assert (change.revision, change.sequence, change.tombstone) == (2, 2, True)
    assert change.payload is None
    assert change.etag == etag_of(None)


async def test_only_changes_after_the_cursor_are_returned(
    store: PostgresSyncStore,
) -> None:
    """A device that is up to date gets nothing and keeps its cursor."""
    records = await _create(store, 3)

    after_two = await _page(store, 2)
    after_three = await _page(store, 3)

    assert _places(after_two.changes) == [(records[2], 1, 3)]
    assert (after_three.changes, after_three.next_cursor) == ([], "3")
    assert after_three.has_more is False


async def test_pages_hold_a_limited_number_of_records_and_miss_none(
    db: Database,
) -> None:
    """Following the cursor across page boundaries reaches every record once."""
    store = PostgresSyncStore(db, page_size=2)
    records = await _create(store, 5)

    pages = [await _page(store, 0)]
    while pages[-1].has_more:
        pages.append(await _page(store, int(pages[-1].next_cursor)))

    assert [len(page.changes) for page in pages] == [2, 2, 1]
    assert [page.next_cursor for page in pages] == ["2", "4", "5"]
    seen = [place for page in pages for place in _places(page.changes)]
    assert seen == [(record, 1, n) for n, record in enumerate(records, start=1)]


async def test_a_page_that_ends_at_the_last_change_does_not_promise_more(
    db: Database,
) -> None:
    """Exactly a page's worth of records is one complete page."""
    store = PostgresSyncStore(db, page_size=2)
    await _create(store, 2)

    assert (await _page(store, 0)).has_more is False


async def test_a_page_stops_growing_once_its_payloads_are_large_enough(
    db: Database,
) -> None:
    """Large records are spread over more pages, and none is skipped."""
    # Each payload is 8 characters: two fit before the 10-character mark.
    store = PostgresSyncStore(db, page_characters=10)
    records = await _create(store, 5)
    await store.apply(OWNER_A, _op(records[0], 1, tombstone=True, payload=None))

    pages = [await _page(store, 0)]
    while pages[-1].has_more:
        pages.append(await _page(store, int(pages[-1].next_cursor)))

    # A page closes once the mark is passed, even for a deletion with no
    # payload: the last page holds the tombstone alone.
    assert [len(page.changes) for page in pages] == [2, 2, 1]
    assert pages[-1].changes[0].tombstone is True
    assert [c.sequence for page in pages for c in page.changes] == [2, 3, 4, 5, 6]


async def test_a_record_larger_than_a_whole_page_is_still_delivered(
    db: Database,
) -> None:
    """The first record always fits, so the feed cannot get stuck."""
    store = PostgresSyncStore(db, page_characters=1)
    await _create(store, 2)

    first = await _page(store, 0)
    second = await _page(store, 1)

    assert ([c.sequence for c in first.changes], first.has_more) == ([1], True)
    assert ([c.sequence for c in second.changes], second.has_more) == ([2], False)


@pytest.mark.parametrize("ahead", [1, 2, 2**62])
async def test_a_cursor_past_anything_the_account_was_given_is_refused(
    store: PostgresSyncStore, ahead: int
) -> None:
    """The store gives no page; the route tells the client to start again."""
    await _create(store, 2)

    assert await store.changes(OWNER_A, 2 + ahead) is None
    assert await store.changes(OWNER_B, ahead) is None


async def test_another_account_sees_none_of_these_records(
    store: PostgresSyncStore,
) -> None:
    """Each account has its own feed and its own sequence (AC-05)."""
    await _create(store, 3)
    (theirs,) = await _create(store, 1, OWNER_B)

    page = await _page(store, 0, OWNER_B)

    assert _places(page.changes) == [(theirs, 1, 1)]
    assert page.next_cursor == "1"
    # A's cursor means nothing to B: B was never given sequence 3.
    assert await store.changes(OWNER_B, 3) is None


class _Held:
    """Hands out one transaction that the test keeps open."""

    def __init__(self, tx: AsyncConnection[TupleRow]) -> None:
        self._tx = tx

    @asynccontextmanager
    async def as_owner(
        self, owner_id: UUID
    ) -> AsyncIterator[AsyncConnection[TupleRow]]:
        """Yield the held transaction without ending it."""
        yield self._tx


async def test_a_later_change_is_never_visible_before_an_earlier_one_commits(
    db: Database, store: PostgresSyncStore
) -> None:
    """A reader cannot be handed sequence 2 while sequence 1 is uncommitted.

    If it could, it would move its cursor to 2 and never ask for 1 again.
    """
    first, second = uuid4(), uuid4()

    async with db.as_owner(OWNER_A) as tx:
        slow = await PostgresSyncStore(_Held(tx)).apply(OWNER_A, _op(first))
        assert slow.status == "applied"

        # A second writer has to wait for the first to finish...
        waiting = asyncio.create_task(store.apply(OWNER_A, _op(second)))
        await asyncio.sleep(0.3)
        assert not waiting.done()
        # ...and a reader, which is not blocked, sees neither change yet.
        during = await _page(store, 0)
        assert (during.changes, during.next_cursor) == ([], "0")
        # Another account is not held up at all.
        (theirs,) = await _create(store, 1, OWNER_B)
        assert _places((await _page(store, 0, OWNER_B)).changes) == [(theirs, 1, 1)]

    assert (await waiting).status == "applied"
    after = await _page(store, 0)
    assert _places(after.changes) == [(first, 1, 1), (second, 1, 2)]


async def test_a_change_that_is_rolled_back_leaves_no_gap_in_the_feed(
    db: Database, store: PostgresSyncStore
) -> None:
    """A failed write gives its sequence number back."""

    class _StopError(Exception):
        """Ends the transaction without committing."""

    with pytest.raises(_StopError):
        async with db.as_owner(OWNER_A) as tx:
            await PostgresSyncStore(_Held(tx)).apply(OWNER_A, _op(uuid4()))
            raise _StopError

    (kept,) = await _create(store, 1)

    assert _places((await _page(store, 0)).changes) == [(kept, 1, 1)]


async def test_a_device_reading_while_others_write_misses_nothing(
    db: Database,
) -> None:
    """Many writers, one reader following its cursor: the reader ends up exact."""
    store = PostgresSyncStore(db, page_size=3)
    records = [uuid4() for _ in range(WRITERS)]
    seen: dict[UUID, int] = {}
    sequences: list[int] = []
    writing = True

    async def write(record: UUID) -> None:
        """Create a record, then change it over and over."""
        for base in range(CHANGES_EACH):
            result = await store.apply(OWNER_A, _op(record, base))
            assert result.status == "applied"

    async def read() -> None:
        """Follow the cursor until the writers stop and the feed is drained."""
        after = 0
        while True:
            finishing = not writing
            page = await _page(store, after)
            for change in page.changes:
                # A record never goes backwards for a device following the feed.
                assert change.revision > seen.get(change.record_id, 0)
                seen[change.record_id] = change.revision
                sequences.append(change.sequence)
            after = int(page.next_cursor)
            if finishing and not page.has_more:
                return
            await asyncio.sleep(0)

    reader = asyncio.create_task(read())
    await asyncio.gather(*(write(record) for record in records))
    writing = False
    await reader

    assert seen == dict.fromkeys(records, CHANGES_EACH)
    assert sequences == sorted(set(sequences))
    assert sequences[-1] == WRITERS * CHANGES_EACH
