"""Recovery envelope routes (PRD SEC-003, DEV-001 path B).

The envelope is the account root key wrapped by the user's recovery key. The
server stores and returns it as an opaque value. It cannot open it, and it
never receives the recovery key.
"""

from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from warmly.api.errors import SIGNED_IN_RESPONSES, ProblemError
from warmly.api.ports import RecoveryStore
from warmly.auth.dependency import CurrentOwner
from warmly.schemas.problem import Problem
from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope

NOT_FOUND_CODE = "recovery.not_found"
VERSION_CONFLICT_CODE = "recovery.version_conflict"

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": Problem, "description": "The account has no recovery envelope"}
}
_CONFLICT: dict[int | str, dict[str, Any]] = {
    409: {
        "model": Problem,
        "description": "The envelope is not at the expected version",
    }
}

router = APIRouter(
    prefix="/recovery-envelope", tags=["recovery"], responses=SIGNED_IN_RESPONSES
)


def _store(request: Request) -> RecoveryStore:
    """Return the application's recovery store."""
    store: RecoveryStore = request.app.state.recovery_store
    return store


Store = Annotated[RecoveryStore, Depends(_store)]


@router.get("", summary="Read the recovery envelope", responses=_NOT_FOUND)
async def get_recovery_envelope(owner: CurrentOwner, store: Store) -> RecoveryEnvelope:
    """Read the caller's wrapped root key.

    Args:
        owner: The verified caller.
        store: Where envelopes are kept.

    Returns:
        The caller's envelope.

    Raises:
        ProblemError: 404 if the account has not created its keys yet.
    """
    envelope = await store.read(owner.id)
    if envelope is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    return envelope


@router.put("", summary="Create or rotate the recovery envelope", responses=_CONFLICT)
async def put_recovery_envelope(
    request: PutRecoveryEnvelopeRequest, owner: CurrentOwner, store: Store
) -> RecoveryEnvelope:
    """Create or rotate the wrapped root key with compare-and-swap.

    ``expected_version`` 0 creates the envelope and fails if one exists. Any
    other value replaces exactly that version. A failed attempt changes
    nothing, so an interrupted rotation leaves the old recovery key valid.

    Args:
        request: The new envelope and the version it replaces.
        owner: The verified caller.
        store: Where envelopes are kept.

    Returns:
        The envelope as stored, with its new version.

    Raises:
        ProblemError: 409 if the stored version is not the expected one.
    """
    envelope = await store.write(owner.id, request)
    if envelope is None:
        raise ProblemError(HTTPStatus.CONFLICT, VERSION_CONFLICT_CODE)
    return envelope
