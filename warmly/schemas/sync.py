"""Sync protocol models (PRD SYNC-002, SYNC-003; ADR-0006).

The scenario table in ``docs/adr/0006-sync-protocol.md`` says which status
each operation gets. ``tests/fixtures/sync/scenarios-v1.json`` is that table
in runnable form; these models must be able to carry every step of it.
"""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from warmly.schemas.common import ApiModel, Ciphertext

MAX_OPERATIONS_PER_BATCH = 100

# Opaque record category. The server stores it and never interprets it.
RecordType = Annotated[int, Field(ge=0, le=255)]

_TOMBSTONE_WITH_PAYLOAD = "a tombstone carries no payload"
_WRITE_WITHOUT_PAYLOAD = "a create or update needs a payload"
_REVISION_WITHOUT_EFFECT = "revision is only set when the operation took effect"
_CURRENT_REVISION_WITH_EFFECT = "current_revision is only set when it did not"

OperationStatus = Literal["applied", "duplicate", "conflict", "deleted", "rejected"]


class SyncOperation(ApiModel):
    """One create, update or delete of an encrypted record."""

    op_id: UUID = Field(description="Client-chosen idempotency key.")
    record_id: UUID = Field(description="Opaque record identifier.")
    type: RecordType
    base_revision: int = Field(
        ge=0, description="Revision this change was made from; 0 for a new record."
    )
    schema_version: int = Field(ge=1, description="Envelope format version.")
    tombstone: bool = Field(description="True when this operation deletes the record.")
    payload: Ciphertext | None = Field(
        default=None, description="Encrypted record; absent for a tombstone."
    )

    @model_validator(mode="after")
    def _payload_matches_tombstone(self) -> "SyncOperation":
        """Require a payload exactly when the operation is not a delete."""
        if self.tombstone and self.payload is not None:
            raise ValueError(_TOMBSTONE_WITH_PAYLOAD)
        if not self.tombstone and self.payload is None:
            raise ValueError(_WRITE_WITHOUT_PAYLOAD)
        return self


class OperationsRequest(ApiModel):
    """An idempotent batch of operations."""

    operations: list[SyncOperation] = Field(
        min_length=1, max_length=MAX_OPERATIONS_PER_BATCH
    )


class OperationResult(ApiModel):
    """Outcome of one operation, in request order."""

    op_id: UUID
    status: OperationStatus
    revision: int | None = Field(
        default=None, description="New revision when the operation was applied."
    )
    current_revision: int | None = Field(
        default=None, description="Server revision when the operation was not applied."
    )

    @model_validator(mode="after")
    def _revisions_match_status(self) -> "OperationResult":
        """Reject results whose revision fields contradict their status.

        ``revision`` is the new revision of an applied (or already applied)
        operation; ``current_revision`` tells a client what it lost to.
        """
        took_effect = self.status in {"applied", "duplicate"}
        if self.revision is not None and not took_effect:
            raise ValueError(_REVISION_WITHOUT_EFFECT)
        if self.current_revision is not None and took_effect:
            raise ValueError(_CURRENT_REVISION_WITH_EFFECT)
        return self


def refusal_for(
    operation: SyncOperation, stored: tuple[int, int, bool] | None
) -> OperationResult | None:
    """Decide whether an operation must be refused (ADR-0006).

    This is the protocol's rule, kept in one place so that every store
    applies it the same way. It never compares timestamps and never lets the
    latest writer win.

    Args:
        operation: The operation to judge.
        stored: The stored record's type, revision and tombstone flag, or
            ``None`` if the account has no such record.

    Returns:
        The refusal, or ``None`` if the operation may be applied.
    """
    op_id = operation.op_id
    if stored is None:
        # A record the server has never seen can only be started from 0.
        if operation.base_revision == 0:
            return None
        return OperationResult(op_id=op_id, status="rejected")
    record_type, revision, tombstone = stored
    if record_type != operation.type:
        return OperationResult(op_id=op_id, status="rejected")
    if tombstone:
        # A deleted record never comes back, whatever is sent.
        return OperationResult(op_id=op_id, status="deleted", current_revision=revision)
    if revision != operation.base_revision:
        return OperationResult(
            op_id=op_id, status="conflict", current_revision=revision
        )
    return None


class OperationsResponse(ApiModel):
    """Results for a batch, one per operation and in the same order."""

    results: list[OperationResult]


class Change(ApiModel):
    """The current state of one record that changed after the cursor."""

    record_id: UUID
    type: RecordType
    revision: int = Field(ge=1)
    sequence: int = Field(ge=1, description="Position in the owner's change feed.")
    schema_version: int = Field(ge=1)
    tombstone: bool
    etag: str = Field(description="Hash of the stored ciphertext.")
    payload: Ciphertext | None = None


class ChangesResponse(ApiModel):
    """One page of the owner's change feed."""

    changes: list[Change]
    next_cursor: str = Field(description="Cursor to send on the next request.")
    has_more: bool
