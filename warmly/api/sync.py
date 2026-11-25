"""Sync routes (PRD SYNC-002, SYNC-003, SYNC-008; ADR-0006).

``POST /v1/sync/operations`` stores ciphertext and assigns revisions.
``GET /v1/sync/changes`` returns what a device has not seen yet. Both act
only on the verified caller's own records, and neither reads a payload.
"""

import re
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request

from warmly.api.errors import SIGNED_IN_RESPONSES, ProblemError
from warmly.api.ports import DeviceStore, SyncStore
from warmly.auth.device import Caller, CurrentCaller, require_device
from warmly.logs import log_failure
from warmly.schemas.problem import Problem
from warmly.schemas.sync import (
    ChangesResponse,
    OperationsRequest,
    OperationsResponse,
)

CURSOR_UNKNOWN_CODE = "sync.cursor_unknown"
UPGRADE_REQUIRED_CODE = "sync.upgrade_required"
# The request header in which a client says which sync version it speaks.
VERSION_HEADER = "Warmly-Sync-Version"
# The response headers that say which versions the server speaks.
MIN_HEADER = "Warmly-Sync-Min"
MAX_HEADER = "Warmly-Sync-Max"
# The name logged when a device's last-sync time could not be stored.
LAST_SYNC_FAILED = "sync.last_sync_failed"

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

_UPGRADE: dict[int | str, dict[str, Any]] = {
    426: {
        "model": Problem,
        "description": (
            "The client speaks a sync version this server does not. Nothing "
            "was applied. Warmly-Sync-Min and Warmly-Sync-Max say which "
            "versions are spoken"
        ),
    }
}

SyncVersion = Annotated[
    str | None,
    Header(
        alias=VERSION_HEADER,
        description="The sync protocol version the client speaks.",
    ),
]


_VERSION = re.compile(r"[0-9]{1,9}")


def require_supported_version(request: Request, version: SyncVersion = None) -> None:
    """Refuse a client that speaks a sync version this server does not.

    Old and new clients are in use at the same time. One that is too old,
    too new or does not say is refused before anything is read or written,
    and told which versions the server speaks, so it can keep its changes
    queued and ask the person to update (ADR-0006).

    Args:
        request: The current request; its application holds the versions.
        version: What the client sent in ``Warmly-Sync-Version``.

    Raises:
        ProblemError: 426 when the version is missing, not a number, or
            outside the supported range.
    """
    oldest, newest = request.app.state.sync_versions
    # A short run of digits and nothing else. The length is limited so that
    # no header, however long, can be anything but a refusal.
    spoken = (
        int(version)
        if version is not None and _VERSION.fullmatch(version) is not None
        else None
    )
    if spoken is None or not oldest <= spoken <= newest:
        raise ProblemError(
            HTTPStatus.UPGRADE_REQUIRED,
            UPGRADE_REQUIRED_CODE,
            headers={MIN_HEADER: str(oldest), MAX_HEADER: str(newest)},
        )


router = APIRouter(
    prefix="/sync",
    tags=["sync"],
    # The device is checked first: only a caller that is allowed to sync is
    # told which versions the server speaks.
    dependencies=[Depends(require_device), Depends(require_supported_version)],
    responses=SIGNED_IN_RESPONSES | _UPGRADE,
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


async def _note_synced(devices: DeviceStore, caller: Caller) -> None:
    """Record that the device has caught up, without letting that fail the read.

    The time is only shown to the person in Manage Devices. If it cannot be
    stored, the device still gets the page it asked for, and the failure is
    logged by name.

    Args:
        devices: Where the device's last sync is recorded.
        caller: The verified account and device.
    """
    if not await devices.mark_synced(caller.owner.id, caller.device_id):
        log_failure(LAST_SYNC_FAILED)


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
        await _note_synced(devices, caller)
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
