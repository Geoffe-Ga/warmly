"""What the routes need from storage, described without naming a database.

Routes depend on these interfaces only. The implementations live in
``warmly.db``, the one package allowed to import the database driver, and are
handed to the application when it is built.
"""

from typing import Protocol
from uuid import UUID

from warmly.auth.device import DeviceKeys
from warmly.schemas.devices import Device, RegisterDeviceRequest
from warmly.schemas.enrollment import Enrollment, StartEnrollmentRequest
from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope
from warmly.schemas.sync import ChangesResponse, OperationResult, SyncOperation


class RecoveryStore(Protocol):
    """Reads and replaces one account's recovery envelope (PRD SEC-003)."""

    async def read(self, owner_id: UUID) -> RecoveryEnvelope | None:
        """Return the owner's envelope, or ``None`` if there is none."""

    async def write(
        self, owner_id: UUID, request: PutRecoveryEnvelopeRequest
    ) -> RecoveryEnvelope | None:
        """Create or replace the envelope; ``None`` if the version moved on."""

    async def enrollment_key(self, owner_id: UUID) -> str | None:
        """Return the account's enrollment public key, or ``None``."""


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

    async def mark_synced(self, owner_id: UUID, device_id: UUID) -> bool:
        """Record that a device has just caught up with the change feed.

        Returns ``False``, without raising, if that could not be stored.
        """

    async def revoke(
        self, owner_id: UUID, device_id: UUID, current: UUID
    ) -> Device | None:
        """Revoke a device for good; ``None`` if it is not the owner's."""


class SyncStore(Protocol):
    """One account's synced records (PRD SYNC-003, SYNC-008; ADR-0006)."""

    async def changes(self, owner_id: UUID, after: int) -> ChangesResponse | None:
        """Return a page of changes; ``None`` if the cursor was never issued."""

    async def apply(self, owner_id: UUID, operation: SyncOperation) -> OperationResult:
        """Apply one operation, or say why it was not applied."""


class EnrollmentStore(Protocol):
    """One account's device pairing requests (PRD DEV-001 path A)."""

    async def start(
        self, owner_id: UUID, request: StartEnrollmentRequest
    ) -> Enrollment:
        """Open a request, ending the owner's earlier open ones."""

    async def read(self, owner_id: UUID, enrollment_id: UUID) -> Enrollment | None:
        """Return the owner's request, or ``None``."""

    async def cancel(self, owner_id: UUID, enrollment_id: UUID) -> Enrollment | None:
        """End an open request early; ``None`` if it is not the owner's."""

    async def open_request(self, owner_id: UUID) -> Enrollment | None:
        """Return the owner's request waiting to be taken up, if any."""

    async def claim(
        self, owner_id: UUID, enrollment_id: UUID, device_id: UUID, nonce: str
    ) -> Enrollment | None:
        """Take up a waiting request; ``None`` if it was not waiting."""

    async def reveal(
        self, owner_id: UUID, enrollment_id: UUID, nonce: str
    ) -> Enrollment | None:
        """Record the new device's value; ``None`` if not claimed."""

    async def approve(
        self, owner_id: UUID, enrollment_id: UUID, device_id: UUID, wrapped_key: str
    ) -> Enrollment | None:
        """Deliver the wrapped key; ``None`` unless revealed and claimed by it."""

    async def reject(
        self, owner_id: UUID, enrollment_id: UUID, device_id: UUID
    ) -> Enrollment | None:
        """Refuse a request; ``None`` unless this device had claimed it."""
