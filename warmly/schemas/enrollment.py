"""Device enrollment models (PRD DEV-001 path A)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from warmly.schemas.common import ApiModel, PublicKey, SmallCiphertext

EnrollmentStatus = Literal["pending", "approved", "expired"]


class StartEnrollmentRequest(ApiModel):
    """A new device asks to be approved by an existing one."""

    device_id: UUID
    public_key: PublicKey


class ApproveEnrollmentRequest(ApiModel):
    """An unlocked device delivers the root key, encrypted to the new device."""

    wrapped_key: SmallCiphertext


class Enrollment(ApiModel):
    """A short-lived, single-use enrollment challenge.

    The server relays ``wrapped_key`` and can never read it.
    """

    id: UUID
    device_id: UUID
    public_key: PublicKey
    challenge: SmallCiphertext = Field(
        description="Server nonce both devices bind into the pairing code."
    )
    status: EnrollmentStatus
    expires_at: datetime
    wrapped_key: SmallCiphertext | None = None
