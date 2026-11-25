"""Device pairing models (PRD DEV-001 path A; ADR-0005).

The server relays these values between two of one account's devices and can
read none of the secrets: the pairing code is computed on the devices, and
the root key crosses only as ciphertext addressed to the new device.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from warmly.schemas.common import ApiModel, PublicKey, SmallCiphertext

EnrollmentStatus = Literal[
    "pending", "claimed", "revealed", "approved", "rejected", "expired"
]

# Exactly 32 bytes in standard base64: a SHA-256 digest or a random value.
Bytes32 = Annotated[
    str,
    StringConstraints(min_length=44, max_length=44, pattern=r"^[A-Za-z0-9+/]{43}=$"),
]


class StartEnrollmentRequest(ApiModel):
    """A new device asks to be approved by an existing one."""

    device_id: UUID
    public_key: PublicKey = Field(
        description="The new device's one-time key-transfer public key."
    )
    commitment: Bytes32 = Field(
        description=(
            "A digest that fixes the new device's random value before the "
            "approving device has chosen its own."
        )
    )


class ClaimEnrollmentRequest(ApiModel):
    """An unlocked device takes up a request and contributes its random value."""

    approver_nonce: Bytes32


class RevealEnrollmentRequest(ApiModel):
    """The new device reveals the random value it committed to."""

    joiner_nonce: Bytes32


class ApproveEnrollmentRequest(ApiModel):
    """An unlocked device delivers the root key, encrypted to the new device."""

    wrapped_key: SmallCiphertext


class Enrollment(ApiModel):
    """A short-lived, single-use pairing between two of an account's devices.

    The server relays every field and can read no secret in it:
    ``wrapped_key`` is encrypted to the new device.
    """

    id: UUID
    device_id: UUID
    public_key: PublicKey
    commitment: Bytes32
    challenge: Bytes32 = Field(
        description="Server random value both devices bind into the pairing code."
    )
    status: EnrollmentStatus
    expires_at: datetime
    approver_nonce: Bytes32 | None = None
    joiner_nonce: Bytes32 | None = None
    wrapped_key: SmallCiphertext | None = None
