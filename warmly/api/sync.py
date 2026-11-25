"""Sync routes (PRD SYNC-002, SYNC-003, SYNC-008; ADR-0006).

``POST /v1/sync/operations`` stores ciphertext and assigns revisions. The
change feed is still a stub and is marked as one.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from warmly.api.errors import SIGNED_IN_RESPONSES
from warmly.api.ports import SyncStore
from warmly.api.stub import mark_stub
from warmly.auth.device import CurrentCaller, require_device
from warmly.schemas.sync import (
    ChangesResponse,
    OperationsRequest,
    OperationsResponse,
)

router = APIRouter(
    prefix="/sync",
    tags=["sync"],
    dependencies=[Depends(require_device)],
    responses=SIGNED_IN_RESPONSES,
)


def _store(request: Request) -> SyncStore:
    """Return the application's sync store."""
    store: SyncStore = request.app.state.sync_store
    return store


Store = Annotated[SyncStore, Depends(_store)]

Cursor = Annotated[
    str,
    Query(
        max_length=64,
        pattern=r"^[0-9]+$",
        description="Last change sequence this device has applied; 0 to start.",
    ),
]


@router.get(
    "/changes",
    summary="List changes after a cursor",
    dependencies=[Depends(mark_stub)],
)
def get_changes(cursor: Cursor = "0") -> ChangesResponse:
    """Return the records that changed after ``cursor``.

    Stub: always an empty page that echoes the cursor back.

    Args:
        cursor: The caller's position in its change feed.

    Returns:
        An empty page of changes.
    """
    return ChangesResponse(changes=[], next_cursor=cursor, has_more=False)


@router.post("/operations", summary="Apply a batch of operations")
async def post_operations(
    request: OperationsRequest, caller: CurrentCaller, store: Store
) -> OperationsResponse:
    """Apply an idempotent batch of record operations.

    Each operation is applied on its own, in request order: one that is
    refused does not stop the others. A change is stored only when it was
    made on top of the record's current revision. The server never merges
    and never lets the latest writer win. Sending an operation that was
    already applied again changes nothing and reports ``duplicate``.

    The payloads are opaque: they are stored as sent and never decoded.

    Args:
        request: The batch to apply.
        caller: The verified account and device.
        store: Where records are kept.

    Returns:
        One result per operation, in request order.
    """
    return OperationsResponse(
        results=[
            await store.apply(caller.owner.id, operation)
            for operation in request.operations
        ]
    )
