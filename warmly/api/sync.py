"""Sync routes (PRD SYNC-002, SYNC-003, SYNC-008; ADR-0006).

``POST /v1/sync/operations`` stores ciphertext and assigns revisions.
``GET /v1/sync/changes`` returns what a device has not seen yet. Both act
only on the verified caller's own records, and neither reads a payload.
"""

from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from warmly.api.errors import SIGNED_IN_RESPONSES, ProblemError
from warmly.api.ports import DeviceStore, SyncStore
from warmly.auth.device import CurrentCaller, require_device
from warmly.schemas.problem import Problem
from warmly.schemas.sync import (
    ChangesResponse,
    OperationsRequest,
    OperationsResponse,
)

CURSOR_UNKNOWN_CODE = "sync.cursor_unknown"

# The largest sequence the database can hold. A cursor beyond it was never
# issued, and is refused before it reaches a query.
_LARGEST_SEQUENCE = 2**63 - 1

_RESYNC: dict[int | str, dict[str, Any]] = {
    409: {
        "model": Problem,
        "description": (
            "The cursor was never given to this account; start again from 0"
        ),
    }
}

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


def _devices(request: Request) -> DeviceStore:
    """Return the application's device store."""
    store: DeviceStore = request.app.state.device_store
    return store


Store = Annotated[SyncStore, Depends(_store)]
Devices = Annotated[DeviceStore, Depends(_devices)]

Cursor = Annotated[
    str,
    Query(
        max_length=64,
        pattern=r"^[0-9]+$",
        description="Last change sequence this device has applied; 0 to start.",
    ),
]


@router.get("/changes", summary="List changes after a cursor", responses=_RESYNC)
async def get_changes(
    caller: CurrentCaller, store: Store, devices: Devices, cursor: Cursor = "0"
) -> ChangesResponse:
    """Return the caller's records that changed after ``cursor``.

    Each record appears once, as it is now, in the order of its latest
    change, deleted records included. Ask again with ``next_cursor`` while
    ``has_more`` is true. When a device reaches the end of the feed, the
    time is recorded as its last sync.

    A cursor this account was never given is refused with
    ``sync.cursor_unknown``: start again from ``0``.

    Args:
        caller: The verified account and device.
        store: Where records are kept.
        devices: Where the device's last sync is recorded.
        cursor: The caller's position in its change feed.

    Returns:
        One page of changes.

    Raises:
        ProblemError: 409 when the cursor was never issued to this account.
    """
    after = int(cursor)
    page = None
    if after <= _LARGEST_SEQUENCE:
        page = await store.changes(caller.owner.id, after)
    if page is None:
        raise ProblemError(HTTPStatus.CONFLICT, CURSOR_UNKNOWN_CODE)
    if not page.has_more:
        await devices.mark_synced(caller.owner.id, caller.device_id)
    return page


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

    A batch is not all-or-nothing. If the request fails part-way, the
    operations already applied stay applied, and sending the batch again
    reports them as ``duplicate``.

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
