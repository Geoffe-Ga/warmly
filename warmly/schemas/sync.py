"""Sync protocol models (PRD SYNC-002, SYNC-003)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from warmly.schemas.common import ApiModel, Ciphertext

MAX_OPERATIONS_PER_BATCH = 100

# Opaque record category. The server stores it and never interprets it.
RecordType = Annotated[int, Field(ge=0, le=255)]

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
