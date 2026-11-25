"""Device pairing routes (PRD DEV-001 path A; ADR-0005).

The new device starts a request and reveals its random value. An unlocked,
registered device takes the request up, and after the person has compared
the pairing code on both screens, delivers the root key encrypted to the new
device. The server relays these messages and can read no secret in them.

The new device's two routes need only the session token: it has no
registered key yet. Nothing they do can release a key. Every route that an
approving device calls requires its signature.
"""

import base64
import binascii
import hashlib
import hmac
from http import HTTPStatus
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status

from warmly.api.errors import SIGNED_IN_RESPONSES, ProblemError
from warmly.api.ports import EnrollmentStore
from warmly.auth.dependency import CurrentOwner
from warmly.auth.device import CurrentCaller
from warmly.schemas.enrollment import (
    ApproveEnrollmentRequest,
    ClaimEnrollmentRequest,
    Enrollment,
    RevealEnrollmentRequest,
    StartEnrollmentRequest,
)
from warmly.schemas.problem import Problem

NOT_FOUND_CODE = "enrollment.not_found"
WRONG_STATE_CODE = "enrollment.wrong_state"
COMMITMENT_MISMATCH_CODE = "enrollment.commitment_mismatch"

_COMMITMENT_LABEL = b"warmly-pairing-commit-v1"

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": Problem, "description": "No such pairing request on this account"}
}
_STEP: dict[int | str, dict[str, Any]] = _NOT_FOUND | {
    409: {
        "model": Problem,
        "description": (
            "The request has expired, or is not at the step this call needs"
        ),
    }
}

router = APIRouter(
    prefix="/enrollments", tags=["enrollment"], responses=SIGNED_IN_RESPONSES
)


def _enrollments(request: Request) -> EnrollmentStore:
    """Return the application's pairing store."""
    store: EnrollmentStore = request.app.state.enrollment_store
    return store


Enrollments = Annotated[EnrollmentStore, Depends(_enrollments)]


def commitment_matches(enrollment: Enrollment, joiner_nonce: str) -> bool:
    """Check a revealed value against the commitment made at the start.

    The commitment is SHA-256 over a label, the device ID with a two-byte
    length in front, the public key and the random value. Checking it here
    is a courtesy, not the control: the approving device checks it too, and
    it is the one that must not be fooled. What the check buys is that
    someone holding only a session token cannot spoil a pairing by revealing
    a made-up value before the new device reveals the real one.

    Args:
        enrollment: The request as stored.
        joiner_nonce: The value being revealed, base64.

    Returns:
        Whether the value is the one the new device committed to.
    """
    try:
        public_key = base64.b64decode(enrollment.public_key, validate=True)
        nonce = base64.b64decode(joiner_nonce, validate=True)
        commitment = base64.b64decode(enrollment.commitment, validate=True)
    except (binascii.Error, ValueError):
        return False
    device_id = str(enrollment.device_id).encode()
    expected = hashlib.sha256(
        _COMMITMENT_LABEL
        + len(device_id).to_bytes(2, "big")
        + device_id
        + public_key
        + nonce
    ).digest()
    return hmac.compare_digest(expected, commitment)


async def _step(
    enrollments: EnrollmentStore,
    owner_id: UUID,
    enrollment_id: UUID,
    advanced: Enrollment | None,
) -> Enrollment:
    """Return an advanced request, or explain why it did not advance.

    Raises:
        ProblemError: 404 if the request is not one of the owner's, whether
            or not it exists on another account; 409 if it exists but was
            expired or at a different step.
    """
    if advanced is not None:
        return advanced
    if await enrollments.read(owner_id, enrollment_id) is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    raise ProblemError(HTTPStatus.CONFLICT, WRONG_STATE_CODE)


@router.post(
    "", status_code=status.HTTP_201_CREATED, summary="Ask to pair a new device"
)
async def start_enrollment(
    request: StartEnrollmentRequest, owner: CurrentOwner, enrollments: Enrollments
) -> Enrollment:
    """Open a pairing request for a new device.

    Any earlier open request of the account ends, so an approving device
    only ever sees one.

    Args:
        request: The new device's ID, one-time public key and commitment.
        owner: The verified account.
        enrollments: Where pairing requests are kept.

    Returns:
        The request, with the server's challenge and its expiry.
    """
    return await enrollments.start(owner.id, request)


@router.get(
    "/open",
    summary="Read the request waiting to be approved",
    responses=_NOT_FOUND,
)
async def get_open_enrollment(
    caller: CurrentCaller, enrollments: Enrollments
) -> Enrollment:
    """Return the account's pairing request that no device has taken up yet.

    Args:
        caller: The verified account and device.
        enrollments: Where pairing requests are kept.

    Returns:
        The waiting request.

    Raises:
        ProblemError: 404 if no request is waiting.
    """
    waiting = await enrollments.open_request(caller.owner.id)
    if waiting is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    return waiting


@router.get("/{enrollment_id}", summary="Read a pairing request", responses=_NOT_FOUND)
async def get_enrollment(
    enrollment_id: UUID, owner: CurrentOwner, enrollments: Enrollments
) -> Enrollment:
    """Read a pairing request. Both devices poll this while pairing.

    Args:
        enrollment_id: The request to read.
        owner: The verified account.
        enrollments: Where pairing requests are kept.

    Returns:
        The request as it stands.

    Raises:
        ProblemError: 404 if the request is not one of the caller's.
    """
    found = await enrollments.read(owner.id, enrollment_id)
    if found is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    return found


@router.post(
    "/{enrollment_id}/claim",
    summary="Take up a pairing request",
    responses=_STEP,
)
async def claim_enrollment(
    enrollment_id: UUID,
    request: ClaimEnrollmentRequest,
    caller: CurrentCaller,
    enrollments: Enrollments,
) -> Enrollment:
    """Take up a waiting request and contribute the approving device's value.

    Args:
        enrollment_id: The request to claim.
        request: The approving device's random value.
        caller: The verified account and device.
        enrollments: Where pairing requests are kept.

    Returns:
        The claimed request.
    """
    claimed = await enrollments.claim(
        caller.owner.id, enrollment_id, caller.device_id, request.approver_nonce
    )
    return await _step(enrollments, caller.owner.id, enrollment_id, claimed)


@router.post(
    "/{enrollment_id}/reveal",
    summary="Reveal the new device's random value",
    responses=_STEP,
)
async def reveal_enrollment(
    enrollment_id: UUID,
    request: RevealEnrollmentRequest,
    owner: CurrentOwner,
    enrollments: Enrollments,
) -> Enrollment:
    """Record the value the new device committed to when it started.

    A value that does not match the commitment is refused and leaves the
    request as it was, so the real value can still be revealed.

    Args:
        enrollment_id: The request.
        request: The new device's random value.
        owner: The verified account.
        enrollments: Where pairing requests are kept.

    Returns:
        The request, now ready for the pairing code to be compared.

    Raises:
        ProblemError: 404 if the request is not the caller's; 409 if the
            value does not match the commitment, or the request is not
            waiting for it.
    """
    stored = await enrollments.read(owner.id, enrollment_id)
    if stored is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    if not commitment_matches(stored, request.joiner_nonce):
        raise ProblemError(HTTPStatus.CONFLICT, COMMITMENT_MISMATCH_CODE)
    revealed = await enrollments.reveal(owner.id, enrollment_id, request.joiner_nonce)
    return await _step(enrollments, owner.id, enrollment_id, revealed)


@router.post(
    "/{enrollment_id}/cancel",
    summary="Give up a pairing request",
    responses=_NOT_FOUND,
)
async def cancel_enrollment(
    enrollment_id: UUID, owner: CurrentOwner, enrollments: Enrollments
) -> Enrollment:
    """End an open request early, for a new device that no longer wants it.

    It needs only the session token, like the new device's other routes, and
    can only ever end a request: someone holding a stolen token gains nothing
    they could not already do by starting a new request.

    Args:
        enrollment_id: The request to end.
        owner: The verified account.
        enrollments: Where pairing requests are kept.

    Returns:
        The request as it now stands. A finished request is unchanged.

    Raises:
        ProblemError: 404 if the request is not one of the caller's.
    """
    ended = await enrollments.cancel(owner.id, enrollment_id)
    if ended is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    return ended


@router.post(
    "/{enrollment_id}/approve",
    summary="Approve a pairing request",
    responses=_STEP,
)
async def approve_enrollment(
    enrollment_id: UUID,
    request: ApproveEnrollmentRequest,
    caller: CurrentCaller,
    enrollments: Enrollments,
) -> Enrollment:
    """Deliver the root key, encrypted to the new device.

    Only the device that claimed the request may approve it. The server
    relays the wrapped key and cannot read it.

    Args:
        enrollment_id: The request being approved.
        request: The root key, encrypted to the new device.
        caller: The verified account and device.
        enrollments: Where pairing requests are kept.

    Returns:
        The approved request carrying the wrapped key.
    """
    approved = await enrollments.approve(
        caller.owner.id, enrollment_id, caller.device_id, request.wrapped_key
    )
    return await _step(enrollments, caller.owner.id, enrollment_id, approved)


@router.post(
    "/{enrollment_id}/reject",
    summary="Refuse a pairing request",
    responses=_STEP,
)
async def reject_enrollment(
    enrollment_id: UUID, caller: CurrentCaller, enrollments: Enrollments
) -> Enrollment:
    """Refuse a request, for example because the pairing codes differed.

    Args:
        enrollment_id: The request being refused.
        caller: The verified account and device.
        enrollments: Where pairing requests are kept.

    Returns:
        The refused request.
    """
    rejected = await enrollments.reject(
        caller.owner.id, enrollment_id, caller.device_id
    )
    return await _step(enrollments, caller.owner.id, enrollment_id, rejected)
