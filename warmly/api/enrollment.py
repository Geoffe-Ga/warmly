"""Device enrollment routes (PRD DEV-001). Stubs: nothing is stored."""

from uuid import UUID

from fastapi import APIRouter, Depends, status

from warmly.api.errors import INVALID_REQUEST_RESPONSES
from warmly.api.fixtures import (
    STUB_CIPHERTEXT,
    STUB_DEVICE_ID,
    STUB_ENROLLMENT_ID,
    STUB_PUBLIC_KEY,
    STUB_TIME,
)
from warmly.api.stub import mark_stub
from warmly.schemas.enrollment import (
    ApproveEnrollmentRequest,
    Enrollment,
    StartEnrollmentRequest,
)

router = APIRouter(
    prefix="/enrollments",
    tags=["enrollment"],
    dependencies=[Depends(mark_stub)],
    responses=INVALID_REQUEST_RESPONSES,
)


@router.post(
    "", status_code=status.HTTP_201_CREATED, summary="Start enrolling a new device"
)
def start_enrollment(request: StartEnrollmentRequest) -> Enrollment:
    """Create an enrollment challenge for a new device.

    Stub: returns a fixed pending challenge.

    Args:
        request: The new device's ID and public key.

    Returns:
        A pending enrollment.
    """
    return Enrollment(
        id=STUB_ENROLLMENT_ID,
        device_id=request.device_id,
        public_key=request.public_key,
        challenge=STUB_CIPHERTEXT,
        status="pending",
        expires_at=STUB_TIME,
    )


@router.get("/{enrollment_id}", summary="Read an enrollment")
def get_enrollment(enrollment_id: UUID) -> Enrollment:
    """Read the state of an enrollment.

    Stub: always pending.

    Args:
        enrollment_id: The enrollment to read.

    Returns:
        A pending enrollment with the requested ID.
    """
    return Enrollment(
        id=enrollment_id,
        device_id=STUB_DEVICE_ID,
        public_key=STUB_PUBLIC_KEY,
        challenge=STUB_CIPHERTEXT,
        status="pending",
        expires_at=STUB_TIME,
    )


@router.post("/{enrollment_id}/approve", summary="Approve an enrollment")
def approve_enrollment(
    enrollment_id: UUID, request: ApproveEnrollmentRequest
) -> Enrollment:
    """Deliver the wrapped root key to a new device.

    Stub: echoes the wrapped key back as an approved enrollment. The server
    only ever relays this value; it cannot read it.

    Args:
        enrollment_id: The enrollment being approved.
        request: The root key, encrypted to the new device.

    Returns:
        An approved enrollment carrying the wrapped key.
    """
    return Enrollment(
        id=enrollment_id,
        device_id=STUB_DEVICE_ID,
        public_key=STUB_PUBLIC_KEY,
        challenge=STUB_CIPHERTEXT,
        status="approved",
        expires_at=STUB_TIME,
        wrapped_key=request.wrapped_key,
    )
