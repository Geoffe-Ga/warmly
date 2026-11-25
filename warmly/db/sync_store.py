"""Storage for synced records (PRD SYNC-003, SYNC-008; ADR-0006).

Each operation is applied in its own transaction, inside
``Database.as_owner``, so row-level security confines it to the caller's own
rows whatever the SQL says. The payload is stored as the text the client
sent. Nothing here decodes it, compares timestamps, or lets the latest writer
win: a change is stored only when it was made on top of the record's current
revision.
"""

import hashlib
from typing import NamedTuple
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import TupleRow

from warmly.db.recovery_store import OwnerTransactions
from warmly.schemas.sync import (
    Change,
    ChangesResponse,
    OperationResult,
    SyncOperation,
    refusal_for,
)

# The most records one page of the feed carries.
PAGE_SIZE = 100
# A page stops growing once the payloads before a record reach this many
# characters, so a page of large records stays a reasonable response. The
# first record always fits, so the feed always moves forward.
PAGE_CHARACTERS = 4_000_000

# Take the account's counter row, creating it at 0 if this is the account's
# first operation. Holding the row lock until the transaction ends makes the
# account's operations run one at a time, so everything read afterwards is
# still true when the write happens.
_LOCK_OWNER = """
    INSERT INTO warmly_private.owner_sequences (owner_id, last_sequence)
         VALUES (%s, 0)
    ON CONFLICT (owner_id) DO UPDATE
            SET last_sequence = warmly_private.owner_sequences.last_sequence
"""

_NEXT_SEQUENCE = """
    UPDATE warmly_private.owner_sequences
       SET last_sequence = last_sequence + 1
     WHERE owner_id = %s
 RETURNING last_sequence
"""

_READ_RECEIPT = """
    SELECT revision
      FROM warmly_private.operation_receipts
     WHERE owner_id = %s
       AND op_id = %s
"""

_READ_RECORD = """
    SELECT type, revision, tombstone
      FROM warmly_private.records
     WHERE owner_id = %s
       AND record_id = %s
"""

_CREATE_RECORD = """
    INSERT INTO warmly_private.records
                (owner_id, record_id, type, schema_version, revision, sequence,
                 tombstone, payload, etag)
         VALUES (%s, %s, %s, %s, 1, %s, %s, %s, %s)
"""

# The revision in the WHERE clause is the compare-and-swap: the row changes
# only if it is still at the revision the operation was made on top of.
_REPLACE_RECORD = """
    UPDATE warmly_private.records
       SET schema_version = %s,
           revision = revision + 1,
           sequence = %s,
           tombstone = %s,
           payload = %s,
           etag = %s,
           updated_at = now()
     WHERE owner_id = %s
       AND record_id = %s
       AND revision = %s
"""

_WRITE_RECEIPT = """
    INSERT INTO warmly_private.operation_receipts
                (owner_id, op_id, record_id, revision)
         VALUES (%s, %s, %s, %s)
"""


_READ_LAST_SEQUENCE = """
    SELECT last_sequence
      FROM warmly_private.owner_sequences
     WHERE owner_id = %s
"""

# The innermost query takes the next records in feed order, one more than a
# page holds, without reading their payloads. The middle one counts them and
# adds up the payload sizes before each. The outer one keeps the records
# that fit and only then reads their payloads.
#
# For a page of 2 and a size mark of 10, with three records of 8 characters
# waiting: the innermost returns all three (2 + 1), so `candidates` is 3;
# the sizes before each are 0, 8 and 16; the first two are kept (0 and 8
# are under 10); the caller takes two and, as 3 > 2, says there is more.
_READ_CHANGES = """
    SELECT record_id, type, revision, sequence, schema_version, tombstone,
           etag, payload, candidates
      FROM (SELECT next.*,
                   count(*) OVER () AS candidates,
                   coalesce(
                       sum(char_length(payload)) OVER (
                           ORDER BY sequence
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                       ),
                       0
                   ) AS characters_before
              FROM (SELECT *
                      FROM warmly_private.records
                     WHERE owner_id = %s
                       AND sequence > %s
                  ORDER BY sequence
                     LIMIT %s) AS next) AS sized
     WHERE characters_before < %s
  ORDER BY sequence
"""


class SyncInvariantError(RuntimeError):
    """A write did not do what the checks before it said it would.

    The account's lock and the read before the write make this impossible.
    If it ever happens, failing is better than telling a device its change
    was stored when it was not.
    """


class _FeedRow(NamedTuple):
    """One row of ``_READ_CHANGES``, in the order it selects."""

    record_id: UUID
    type: int
    revision: int
    sequence: int
    schema_version: int
    tombstone: bool
    etag: str
    payload: str | None
    # How many records the innermost query found, on every row.
    candidates: int


def etag_of(payload: str | None) -> str:
    """Hash a stored payload, without decoding it.

    Args:
        payload: The payload text as the client sent it; ``None`` for a
            tombstone.

    Returns:
        SHA-256 of the text, in lower-case hex.
    """
    # A payload is base64 (the ``Ciphertext`` wire type), so it is ASCII.
    return hashlib.sha256((payload or "").encode("ascii")).hexdigest()


async def _one(
    tx: AsyncConnection[TupleRow], query: str, params: tuple[object, ...]
) -> TupleRow | None:
    """Run a query and return its first row, if any."""
    cursor = await tx.execute(query, params)
    return await cursor.fetchone()


class PostgresSyncStore:
    """The records, sequence and receipt tables."""

    def __init__(
        self,
        database: OwnerTransactions,
        *,
        page_size: int = PAGE_SIZE,
        page_characters: int = PAGE_CHARACTERS,
    ) -> None:
        """Create the store.

        Args:
            database: Where owner-scoped transactions come from.
            page_size: The most records one page of the feed carries.
            page_characters: The payload size at which a page stops growing.
        """
        self._database = database
        self._page_size = page_size
        self._page_characters = page_characters

    async def changes(self, owner_id: UUID, after: int) -> ChangesResponse | None:
        """Return one page of the owner's records that changed after a cursor.

        Each record appears once, as it is now, at the place of its latest
        change. An account's changes are committed one at a time and in
        sequence order (``apply`` holds the account's lock until it commits),
        so a reader never sees a later change without every earlier one: a
        cursor it has reached has nothing unseen behind it.

        Args:
            owner_id: The verified owner.
            after: The last sequence the device has applied; 0 to start.

        Returns:
            The page, or ``None`` when the cursor is past anything this
            account has ever been given.
        """
        async with self._database.as_owner(owner_id) as tx:
            # Two statements, each seeing what is committed when it runs.
            # That is safe: writes commit in sequence order, so the page can
            # only hold more than `last` promised, never skip below it.
            last = await _one(tx, _READ_LAST_SEQUENCE, (owner_id,))
            if after > (0 if last is None else last[0]):
                return None
            cursor = await tx.execute(
                _READ_CHANGES,
                (owner_id, after, self._page_size + 1, self._page_characters),
            )
            rows = [_FeedRow(*row) for row in await cursor.fetchall()]
        page = rows[: self._page_size]
        candidates = rows[0].candidates if rows else 0
        return ChangesResponse(
            changes=[
                Change(
                    record_id=row.record_id,
                    type=row.type,
                    revision=row.revision,
                    sequence=row.sequence,
                    schema_version=row.schema_version,
                    tombstone=row.tombstone,
                    etag=row.etag,
                    payload=row.payload,
                )
                for row in page
            ],
            next_cursor=str(page[-1].sequence if page else after),
            has_more=candidates > len(page),
        )

    async def apply(self, owner_id: UUID, operation: SyncOperation) -> OperationResult:
        """Apply one operation, or say why not, in one transaction.

        Args:
            owner_id: The verified owner.
            operation: The change to apply.

        Returns:
            What was done. ``applied`` and ``duplicate`` carry the revision
            the operation produced; ``conflict`` and ``deleted`` carry the
            record's current revision.
        """
        async with self._database.as_owner(owner_id) as tx:
            await tx.execute(_LOCK_OWNER, (owner_id,))
            receipt = await _one(tx, _READ_RECEIPT, (owner_id, operation.op_id))
            if receipt is not None:
                return OperationResult(
                    op_id=operation.op_id, status="duplicate", revision=receipt[0]
                )
            stored = await _one(tx, _READ_RECORD, (owner_id, operation.record_id))
            refusal = refusal_for(operation, stored)
            if refusal is not None:
                return refusal
            revision = await self._write(tx, owner_id, operation)
            await tx.execute(
                _WRITE_RECEIPT,
                (owner_id, operation.op_id, operation.record_id, revision),
            )
            return OperationResult(
                op_id=operation.op_id, status="applied", revision=revision
            )

    async def _write(
        self, tx: AsyncConnection[TupleRow], owner_id: UUID, operation: SyncOperation
    ) -> int:
        """Store an accepted operation and return the record's new revision."""
        cursor = await tx.execute(_NEXT_SEQUENCE, (owner_id,))
        # The counter row exists: the caller took it before anything else.
        (sequence,) = await cursor.fetchone() or (None,)
        payload = None if operation.tombstone else operation.payload
        etag = etag_of(payload)
        if operation.base_revision == 0:
            await tx.execute(
                _CREATE_RECORD,
                (
                    owner_id,
                    operation.record_id,
                    operation.type,
                    operation.schema_version,
                    sequence,
                    operation.tombstone,
                    payload,
                    etag,
                ),
            )
            return 1
        replaced = await tx.execute(
            _REPLACE_RECORD,
            (
                operation.schema_version,
                sequence,
                operation.tombstone,
                payload,
                etag,
                owner_id,
                operation.record_id,
                operation.base_revision,
            ),
        )
        if replaced.rowcount != 1:
            # Raising rolls the transaction back: no sequence number is
            # used and no receipt is kept.
            raise SyncInvariantError
        return operation.base_revision + 1
