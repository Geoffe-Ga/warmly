"""What the routes need from storage, described without naming a database.

Routes depend on these interfaces only. The implementations live in
``warmly.db``, the one package allowed to import the database driver, and are
handed to the application when it is built.
"""

from typing import Protocol
from uuid import UUID

from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope


class RecoveryStore(Protocol):
    """Reads and replaces one account's recovery envelope (PRD SEC-003)."""

    async def read(self, owner_id: UUID) -> RecoveryEnvelope | None:
        """Return the owner's envelope, or ``None`` if there is none."""

    async def write(
        self, owner_id: UUID, request: PutRecoveryEnvelopeRequest
    ) -> RecoveryEnvelope | None:
        """Create or replace the envelope; ``None`` if the version moved on."""
