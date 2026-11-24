"""Sync routes (PRD SYNC-002). Stubs: nothing is stored or returned."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from warmly.api.stub import mark_stub
from warmly.schemas.problem import Problem
from warmly.schemas.sync import (
    ChangesResponse,
    OperationResult,
    OperationsRequest,
    OperationsResponse,
)

router = APIRouter(
    prefix="/sync",
    tags=["sync"],
    dependencies=[Depends(mark_stub)],
    responses={422: {"model": Problem}},
)

Cursor = Annotated[
    str,
    Query(
        max_length=64,
        pattern=r"^[0-9]+$",
        description="Last change sequence this device has applied; 0 to start.",
    ),
]


@router.get("/changes", summary="List changes after a cursor")
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
def post_operations(request: OperationsRequest) -> OperationsResponse:
    """Apply an idempotent batch of record operations.

    Stub: reports every operation as rejected, because nothing is persisted.
    The payloads are validated for shape only and are otherwise untouched.

    Args:
        request: The batch to apply.

    Returns:
        One ``rejected`` result per operation, in request order.
    """
    return OperationsResponse(
        results=[
            OperationResult(op_id=operation.op_id, status="rejected")
            for operation in request.operations
        ]
    )
