"""Storage for recovery envelopes (PRD SEC-003).

Every query runs inside ``Database.as_owner``, so row-level security confines
it to the caller's own row whatever the SQL says. The owner filters below are
there for clarity and for the query planner, not as the security boundary.
"""

from contextlib import AbstractAsyncContextManager
from typing import Protocol
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import TupleRow

from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope

_READ = """
    SELECT version, format_version, wrapped_key
      FROM warmly_private.recovery_envelopes
     WHERE owner_id = %s
"""

_READ_ENROLLMENT_KEY = """
    SELECT device_enrollment_key
      FROM warmly_private.recovery_envelopes
     WHERE owner_id = %s
"""

# Creation succeeds only when the account has no envelope yet.
_CREATE = """
    INSERT INTO warmly_private.recovery_envelopes
                (owner_id, version, format_version, wrapped_key,
                 device_enrollment_key)
         VALUES (%s, 1, %s, %s, %s)
    ON CONFLICT (owner_id) DO NOTHING
      RETURNING version, format_version, wrapped_key
"""

# Rotation succeeds only from the version the caller last saw. The check and
# the write are one statement, so two rotations cannot both win.
_REPLACE = """
    UPDATE warmly_private.recovery_envelopes
       SET version = version + 1,
           format_version = %s,
           wrapped_key = %s,
           updated_at = now()
     WHERE owner_id = %s
       AND version = %s
 RETURNING version, format_version, wrapped_key
"""


class OwnerTransactions(Protocol):
    """Anything that can run a transaction confined to one owner."""

    def as_owner(
        self, owner_id: UUID
    ) -> AbstractAsyncContextManager[AsyncConnection[TupleRow]]:
        """Run one transaction on behalf of ``owner_id``."""


def _envelope(row: tuple[object, ...] | None) -> RecoveryEnvelope | None:
    """Build the wire model from a row, if there is one."""
    if row is None:
        return None
    version, format_version, wrapped_key = row
    return RecoveryEnvelope.model_validate(
        {
            "version": version,
            "format_version": format_version,
            "wrapped_key": wrapped_key,
        }
    )


class PostgresRecoveryStore:
    """The recovery envelope table."""

    def __init__(self, database: OwnerTransactions) -> None:
        """Create the store.

        Args:
            database: Where owner-scoped transactions come from.
        """
        self._database = database

    async def read(self, owner_id: UUID) -> RecoveryEnvelope | None:
        """Return the owner's envelope, or ``None`` if there is none.

        Args:
            owner_id: The verified owner.

        Returns:
            The stored envelope, if any.
        """
        async with self._database.as_owner(owner_id) as tx:
            cursor = await tx.execute(_READ, (owner_id,))
            return _envelope(await cursor.fetchone())

    async def write(
        self, owner_id: UUID, request: PutRecoveryEnvelopeRequest
    ) -> RecoveryEnvelope | None:
        """Create or replace the envelope with compare-and-swap.

        ``expected_version`` 0 means "create": it succeeds only if the account
        has no envelope. Any other value means "replace exactly that
        version". Nothing is changed when the expectation does not hold.

        Args:
            owner_id: The verified owner.
            request: The new envelope and the version it replaces.

        Returns:
            The stored envelope, or ``None`` if the version had moved on.
        """
        async with self._database.as_owner(owner_id) as tx:
            if request.expected_version == 0:
                cursor = await tx.execute(
                    _CREATE,
                    (
                        owner_id,
                        request.format_version,
                        request.wrapped_key,
                        request.device_enrollment_key,
                    ),
                )
            else:
                cursor = await tx.execute(
                    _REPLACE,
                    (
                        request.format_version,
                        request.wrapped_key,
                        owner_id,
                        request.expected_version,
                    ),
                )
            return _envelope(await cursor.fetchone())

    async def enrollment_key(self, owner_id: UUID) -> str | None:
        """Return the public key a new device's registration is checked against.

        Args:
            owner_id: The verified owner.

        Returns:
            The enrollment public key stored with the envelope, or ``None``
            if the account has no envelope or its envelope has no key.
        """
        async with self._database.as_owner(owner_id) as tx:
            cursor = await tx.execute(_READ_ENROLLMENT_KEY, (owner_id,))
            row = await cursor.fetchone()
        return None if row is None or row[0] is None else str(row[0])
