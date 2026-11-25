"""Storage for device identities and used request nonces (ADR-0005).

Every query runs inside ``Database.as_owner``, so row-level security confines
it to the caller's own devices whatever the SQL says. A device ID that belongs
to another account is therefore simply not found (PRD DEV-010).
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from psycopg import errors

from warmly.db.recovery_store import OwnerTransactions
from warmly.schemas.devices import Device, RegisterDeviceRequest

_FIND = """
    SELECT id, public_key, revoked_at IS NOT NULL
      FROM warmly_private.devices
     WHERE id = %s
"""

# The three statements below return the same columns, in the order
# ``_device`` reads them.
_LIST = """
    SELECT id, name_ciphertext, public_key, created_at, last_sync_at, revoked_at
      FROM warmly_private.devices
  ORDER BY created_at, id
"""

_REGISTER = """
    INSERT INTO warmly_private.devices (id, owner_id, public_key, name_ciphertext)
         VALUES (%s, %s, %s, %s)
    ON CONFLICT (id) DO NOTHING
      RETURNING id, name_ciphertext, public_key, created_at, last_sync_at, revoked_at
"""

_RENAME = """
    UPDATE warmly_private.devices
       SET name_ciphertext = %s
     WHERE id = %s
 RETURNING id, name_ciphertext, public_key, created_at, last_sync_at, revoked_at
"""

# A revoked device never reaches this: its requests are refused first. The
# condition is here so that stays true whatever calls it.
_MARK_SYNCED = """
    UPDATE warmly_private.devices
       SET last_sync_at = now()
     WHERE id = %s
       AND revoked_at IS NULL
"""

# Revoking twice changes nothing: the first time stands.
_REVOKE = """
    UPDATE warmly_private.devices
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = %s
 RETURNING id, name_ciphertext, public_key, created_at, last_sync_at, revoked_at
"""

_RECORD_REVOCATION = """
    INSERT INTO warmly_private.device_revocations
                (device_id, owner_id, revoked_by, revoked_at)
         VALUES (%s, %s, %s, %s)
    ON CONFLICT (device_id) DO NOTHING
"""

# Expired nonces are removed as new ones arrive, so the table stays as small
# as the number of requests made in the last few minutes.
_FORGET_EXPIRED = """
    DELETE FROM warmly_private.device_request_nonces
     WHERE device_id = %s
       AND expires_at < now()
"""

_USE_NONCE = """
    INSERT INTO warmly_private.device_request_nonces
                (device_id, nonce, owner_id, expires_at)
         VALUES (%s, %s, %s, %s)
    ON CONFLICT (device_id, nonce) DO NOTHING
"""


@dataclass(frozen=True)
class StoredDevice:
    """A device's key and standing, for checking its request signatures."""

    public_key: str
    revoked: bool


def _device(row: tuple[object, ...], current: UUID) -> Device:
    """Build the wire model from a row."""
    device_id, name_ciphertext, public_key, created_at, last_sync_at, revoked_at = row
    return Device.model_validate(
        {
            "id": device_id,
            "name_ciphertext": name_ciphertext,
            "public_key": public_key,
            "created_at": created_at,
            "last_sync_at": last_sync_at,
            "revoked_at": revoked_at,
            "is_current": device_id == current,
        }
    )


class PostgresDeviceStore:
    """The devices and nonce tables."""

    def __init__(self, database: OwnerTransactions) -> None:
        """Create the store.

        Args:
            database: Where owner-scoped transactions come from.
        """
        self._database = database

    async def find(self, owner_id: UUID, device_id: UUID) -> StoredDevice | None:
        """Return the owner's device with this ID, or ``None``.

        Args:
            owner_id: The verified owner.
            device_id: The device named by the request.

        Returns:
            The device, if it exists and belongs to the owner.
        """
        async with self._database.as_owner(owner_id) as tx:
            cursor = await tx.execute(_FIND, (device_id,))
            row = await cursor.fetchone()
        if row is None:
            return None
        return StoredDevice(public_key=str(row[1]), revoked=bool(row[2]))

    async def use_nonce(
        self, owner_id: UUID, device_id: UUID, nonce: str, expires_at: datetime
    ) -> bool:
        """Record a nonce. Return ``False`` if it was already used.

        The insert is one statement with a unique key, so two requests that
        carry the same nonce cannot both succeed.

        Args:
            owner_id: The verified owner.
            device_id: The device that signed the request.
            nonce: The request's nonce.
            expires_at: When the nonce no longer needs remembering.

        Returns:
            Whether the nonce was new.
        """
        async with self._database.as_owner(owner_id) as tx:
            await tx.execute(_FORGET_EXPIRED, (device_id,))
            cursor = await tx.execute(
                _USE_NONCE, (device_id, nonce, owner_id, expires_at)
            )
            return cursor.rowcount == 1

    async def list(self, owner_id: UUID, current: UUID) -> list[Device]:
        """Return the owner's devices, oldest first.

        Args:
            owner_id: The verified owner.
            current: The device making the request, marked in the result.

        Returns:
            The owner's devices only.
        """
        async with self._database.as_owner(owner_id) as tx:
            cursor = await tx.execute(_LIST)
            return [_device(row, current) for row in await cursor.fetchall()]

    async def register(
        self, owner_id: UUID, request: RegisterDeviceRequest
    ) -> Device | None:
        """Add a device for the owner.

        Args:
            owner_id: The verified owner.
            request: The device's ID, public key and encrypted name.

        Returns:
            The device, or ``None`` if that device ID is already registered,
            to this account or any other.
        """
        try:
            async with self._database.as_owner(owner_id) as tx:
                cursor = await tx.execute(
                    _REGISTER,
                    (
                        request.device_id,
                        owner_id,
                        request.public_key,
                        request.name_ciphertext,
                    ),
                )
                row = await cursor.fetchone()
        except errors.InsufficientPrivilege:
            # The ID exists under another account: the conflict is on a row
            # this owner may not see, which the policy reports this way.
            return None
        return None if row is None else _device(row, request.device_id)

    async def rename(
        self, owner_id: UUID, device_id: UUID, name_ciphertext: str, current: UUID
    ) -> Device | None:
        """Replace a device's encrypted name.

        Args:
            owner_id: The verified owner.
            device_id: The device to rename.
            name_ciphertext: The new encrypted name.
            current: The device making the request.

        Returns:
            The device, or ``None`` if it is not one of the owner's.
        """
        async with self._database.as_owner(owner_id) as tx:
            cursor = await tx.execute(_RENAME, (name_ciphertext, device_id))
            row = await cursor.fetchone()
        return None if row is None else _device(row, current)

    async def mark_synced(self, owner_id: UUID, device_id: UUID) -> None:
        """Record that a device has just caught up with the change feed.

        Args:
            owner_id: The verified owner.
            device_id: The device that made the request.
        """
        async with self._database.as_owner(owner_id) as tx:
            await tx.execute(_MARK_SYNCED, (device_id,))

    async def revoke(
        self, owner_id: UUID, device_id: UUID, current: UUID
    ) -> Device | None:
        """Revoke a device and record it in the append-only ledger.

        Both happen in one transaction. Revoking a device that is already
        revoked changes nothing and returns it as it stands.

        Args:
            owner_id: The verified owner.
            device_id: The device to revoke.
            current: The device making the request.

        Returns:
            The revoked device, or ``None`` if it is not one of the owner's.
        """
        async with self._database.as_owner(owner_id) as tx:
            cursor = await tx.execute(_REVOKE, (device_id,))
            row = await cursor.fetchone()
            if row is None:
                return None
            await tx.execute(_RECORD_REVOCATION, (device_id, owner_id, current, row[5]))
        return _device(row, current)
