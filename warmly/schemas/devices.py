"""Device registry models (PRD DEV-002, DEV-003)."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from warmly.schemas.common import ApiModel, PublicKey, SmallCiphertext


class Device(ApiModel):
    """One of the signed-in user's own devices."""

    id: UUID
    name_ciphertext: SmallCiphertext = Field(
        description="Device name, encrypted on the client."
    )
    public_key: PublicKey
    created_at: datetime
    last_sync_at: datetime | None = None
    revoked_at: datetime | None = None
    is_current: bool = Field(description="True for the device making the request.")


class DeviceList(ApiModel):
    """The signed-in user's devices."""

    devices: list[Device]


class RegisterDeviceRequest(ApiModel):
    """Register the calling device's identity."""

    device_id: UUID
    public_key: PublicKey
    name_ciphertext: SmallCiphertext
    enrollment_proof: SmallCiphertext = Field(
        description=(
            "Proof that the registering device knows the account root key: "
            "an HMAC over the device ID and public key."
        )
    )


class RenameDeviceRequest(ApiModel):
    """Replace a device's encrypted display name."""

    name_ciphertext: SmallCiphertext
