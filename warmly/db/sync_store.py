"""Storage for synced records (PRD SYNC-003, SYNC-008; ADR-0006).

Each operation is applied in its own transaction, inside
``Database.as_owner``, so row-level security confines it to the caller's own
rows whatever the SQL says. The payload is stored as the text the client
sent. Nothing here decodes it, compares timestamps, or lets the latest writer
win: a change is stored only when it was made on top of the record's current
revision.
"""

import hashlib
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import TupleRow

from warmly.db.recovery_store import OwnerTransactions
from warmly.schemas.sync import OperationResult, SyncOperation, refusal_for

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


def etag_of(payload: str | None) -> str:
    """Hash a stored payload, without decoding it.

    Args:
        payload: The payload text as the client sent it; ``None`` for a
            tombstone.

    Returns:
        SHA-256 of the text, in lower-case hex.
    """
    return hashlib.sha256((payload or "").encode("ascii")).hexdigest()


async def _one(
    tx: AsyncConnection[TupleRow], query: str, params: tuple[object, ...]
) -> TupleRow | None:
    """Run a query and return its first row, if any."""
    cursor = await tx.execute(query, params)
    return await cursor.fetchone()


class PostgresSyncStore:
    """The records, sequence and receipt tables."""

    def __init__(self, database: OwnerTransactions) -> None:
        """Create the store.

        Args:
            database: Where owner-scoped transactions come from.
        """
        self._database = database

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
        await tx.execute(
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
        return operation.base_revision + 1
