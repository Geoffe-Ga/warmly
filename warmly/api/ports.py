"""What the routes need from storage, described without naming a database.

Routes depend on these interfaces only. The implementations live in
``warmly.db``, the one package allowed to import the database driver, and are
handed to the application when it is built.
"""

from typing import Protocol
from uuid import UUID

from warmly.auth.device import DeviceKeys
from warmly.schemas.devices import Device, RegisterDeviceRequest
from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope


class RecoveryStore(Protocol):
    """Reads and replaces one account's recovery envelope (PRD SEC-003)."""

    async def read(self, owner_id: UUID) -> RecoveryEnvelope | None:
        """Return the owner's envelope, or ``None`` if there is none."""

    async def write(
        self, owner_id: UUID, request: PutRecoveryEnvelopeRequest
    ) -> RecoveryEnvelope | None:
        """Create or replace the envelope; ``None`` if the version moved on."""

    async def enrollment_verifier(self, owner_id: UUID) -> str | None:
        """Return what a new device must prove it knows, or ``None``."""


class DeviceStore(DeviceKeys, Protocol):
    """The owner's registered devices (PRD DEV-002, DEV-003)."""

    async def list(self, owner_id: UUID, current: UUID) -> list[Device]:
        """Return the owner's devices, oldest first, marking ``current``."""

    async def register(
        self, owner_id: UUID, request: RegisterDeviceRequest
    ) -> Device | None:
        """Add a device; ``None`` if that device ID is already taken."""

    async def rename(
        self, owner_id: UUID, device_id: UUID, name_ciphertext: str, current: UUID
    ) -> Device | None:
        """Replace a device's encrypted name; ``None`` if it is not the owner's."""
