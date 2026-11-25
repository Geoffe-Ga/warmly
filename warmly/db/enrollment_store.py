"""Storage for device pairing requests (PRD DEV-001 path A; ADR-0005).

Every query runs inside ``Database.as_owner``, so a pairing can only ever be
seen or advanced by the account that started it: one account's devices cannot
be paired with another's.

Each step is one ``UPDATE`` that names the state it expects, so a step
happens at most once and two devices racing for it cannot both win. A request
past its expiry reads as ``expired``, gives up no wrapped key, and can no
longer be advanced.
"""

import base64
import secrets
from datetime import timedelta
from uuid import UUID, uuid4

from warmly.db.recovery_store import OwnerTransactions
from warmly.schemas.enrollment import Enrollment, StartEnrollmentRequest

# How long a pairing request stays usable.
ENROLLMENT_LIFETIME = timedelta(minutes=5)
_CHALLENGE_BYTES = 32

# A new request ends the account's earlier open ones, so there is never more
# than one for an approving device to take up.
_END_OPEN = """
    UPDATE warmly_private.device_enrollments
       SET expires_at = now()
     WHERE status IN ('pending', 'claimed', 'revealed')
       AND expires_at > now()
"""

# Past its expiry a request gives up no wrapped key; this removes it from
# the row as well, the next time the request is looked at.
_CLEAR_EXPIRED_KEY = """
    UPDATE warmly_private.device_enrollments
       SET wrapped_key = NULL
     WHERE id = %s
       AND wrapped_key IS NOT NULL
       AND expires_at <= now()
"""

# The new device may give up its own request while it is still open.
_CANCEL = """
    UPDATE warmly_private.device_enrollments
       SET expires_at = now()
     WHERE id = %s
       AND status IN ('pending', 'claimed', 'revealed')
       AND expires_at > now()
"""

_FORGET_OLD = """
    DELETE FROM warmly_private.device_enrollments
     WHERE expires_at < now() - interval '1 hour'
"""

# Every statement below returns the same columns, in the order ``_enrollment``
# reads them.
_START = """
    INSERT INTO warmly_private.device_enrollments
                (id, owner_id, device_id, public_key, commitment, challenge,
                 expires_at)
         VALUES (%s, %s, %s, %s, %s, %s, now() + %s)
      RETURNING id, device_id, public_key, commitment, challenge, status,
                expires_at, approver_nonce, joiner_nonce, wrapped_key
"""

_READ = """
    SELECT id, device_id, public_key, commitment, challenge,
           CASE WHEN expires_at > now() THEN status ELSE 'expired' END,
           expires_at, approver_nonce, joiner_nonce,
           CASE WHEN expires_at > now() THEN wrapped_key END
      FROM warmly_private.device_enrollments
     WHERE id = %s
"""

_OPEN = """
    SELECT id, device_id, public_key, commitment, challenge, status,
           expires_at, approver_nonce, joiner_nonce, wrapped_key
      FROM warmly_private.device_enrollments
     WHERE status = 'pending'
       AND expires_at > now()
  ORDER BY created_at DESC, id
     LIMIT 1
"""

_CLAIM = """
    UPDATE warmly_private.device_enrollments
       SET status = 'claimed', approver_device_id = %s, approver_nonce = %s
     WHERE id = %s
       AND status = 'pending'
       AND expires_at > now()
 RETURNING id, device_id, public_key, commitment, challenge, status,
           expires_at, approver_nonce, joiner_nonce, wrapped_key
"""

_REVEAL = """
    UPDATE warmly_private.device_enrollments
       SET status = 'revealed', joiner_nonce = %s
     WHERE id = %s
       AND status = 'claimed'
       AND expires_at > now()
 RETURNING id, device_id, public_key, commitment, challenge, status,
           expires_at, approver_nonce, joiner_nonce, wrapped_key
"""

# Only the device that claimed a request may finish it.
_APPROVE = """
    UPDATE warmly_private.device_enrollments
       SET status = 'approved', wrapped_key = %s
     WHERE id = %s
       AND status = 'revealed'
       AND approver_device_id = %s
       AND expires_at > now()
 RETURNING id, device_id, public_key, commitment, challenge, status,
           expires_at, approver_nonce, joiner_nonce, wrapped_key
"""

_REJECT = """
    UPDATE warmly_private.device_enrollments
       SET status = 'rejected'
     WHERE id = %s
       AND status IN ('claimed', 'revealed')
       AND approver_device_id = %s
       AND expires_at > now()
 RETURNING id, device_id, public_key, commitment, challenge, status,
           expires_at, approver_nonce, joiner_nonce, wrapped_key
"""


def _enrollment(row: tuple[object, ...] | None) -> Enrollment | None:
    """Build the wire model from a row, if there is one."""
    if row is None:
        return None
    keys = (
        "id",
        "device_id",
        "public_key",
        "commitment",
        "challenge",
        "status",
        "expires_at",
        "approver_nonce",
        "joiner_nonce",
        "wrapped_key",
    )
    return Enrollment.model_validate(dict(zip(keys, row, strict=True)))


class PostgresEnrollmentStore:
    """The device pairing table."""

    def __init__(self, database: OwnerTransactions) -> None:
        """Create the store.

        Args:
            database: Where owner-scoped transactions come from.
        """
        self._database = database

    async def _one(
        self, owner_id: UUID, statement: str, parameters: tuple[object, ...]
    ) -> Enrollment | None:
        """Run a statement as the owner and read the row it returns."""
        async with self._database.as_owner(owner_id) as tx:
            cursor = await tx.execute(statement, parameters)
            return _enrollment(await cursor.fetchone())

    async def start(
        self, owner_id: UUID, request: StartEnrollmentRequest
    ) -> Enrollment:
        """Open a pairing request, ending the owner's earlier open ones.

        Args:
            owner_id: The verified owner.
            request: The new device's ID, public key and commitment.

        Returns:
            The new request, with the server's challenge and expiry.
        """
        challenge = base64.b64encode(secrets.token_bytes(_CHALLENGE_BYTES)).decode()
        async with self._database.as_owner(owner_id) as tx:
            await tx.execute(_FORGET_OLD)
            await tx.execute(_END_OPEN)
            cursor = await tx.execute(
                _START,
                (
                    uuid4(),
                    owner_id,
                    request.device_id,
                    request.public_key,
                    request.commitment,
                    challenge,
                    ENROLLMENT_LIFETIME,
                ),
            )
            started = _enrollment(await cursor.fetchone())
        if started is None:
            msg = "The pairing request was not stored"
            raise RuntimeError(msg)
        return started

    async def read(self, owner_id: UUID, enrollment_id: UUID) -> Enrollment | None:
        """Return the owner's pairing request with this ID, or ``None``.

        Args:
            owner_id: The verified owner.
            enrollment_id: The request to read.

        Returns:
            The request. Past its expiry it reads as ``expired`` and carries
            no wrapped key.
        """
        async with self._database.as_owner(owner_id) as tx:
            await tx.execute(_CLEAR_EXPIRED_KEY, (enrollment_id,))
            cursor = await tx.execute(_READ, (enrollment_id,))
            return _enrollment(await cursor.fetchone())

    async def cancel(self, owner_id: UUID, enrollment_id: UUID) -> Enrollment | None:
        """End an open request early, at the new device's wish.

        A finished or already expired request is left as it is.

        Args:
            owner_id: The verified owner.
            enrollment_id: The request to end.

        Returns:
            The request as it now stands, or ``None`` if it is not the
            owner's.
        """
        async with self._database.as_owner(owner_id) as tx:
            await tx.execute(_CANCEL, (enrollment_id,))
            cursor = await tx.execute(_READ, (enrollment_id,))
            return _enrollment(await cursor.fetchone())

    async def open_request(self, owner_id: UUID) -> Enrollment | None:
        """Return the owner's request that is waiting to be taken up, if any.

        Args:
            owner_id: The verified owner.

        Returns:
            The newest unexpired request nobody has claimed.
        """
        return await self._one(owner_id, _OPEN, ())

    async def claim(
        self, owner_id: UUID, enrollment_id: UUID, device_id: UUID, nonce: str
    ) -> Enrollment | None:
        """Take up a waiting request for one approving device.

        Args:
            owner_id: The verified owner.
            enrollment_id: The request to claim.
            device_id: The approving device.
            nonce: The approving device's random value.

        Returns:
            The request, or ``None`` if it was not waiting.
        """
        return await self._one(owner_id, _CLAIM, (device_id, nonce, enrollment_id))

    async def reveal(
        self, owner_id: UUID, enrollment_id: UUID, nonce: str
    ) -> Enrollment | None:
        """Record the new device's random value, once the request is claimed.

        Args:
            owner_id: The verified owner.
            enrollment_id: The request.
            nonce: The value the new device committed to.

        Returns:
            The request, or ``None`` if it was not claimed and unrevealed.
        """
        return await self._one(owner_id, _REVEAL, (nonce, enrollment_id))

    async def approve(
        self, owner_id: UUID, enrollment_id: UUID, device_id: UUID, wrapped_key: str
    ) -> Enrollment | None:
        """Deliver the wrapped root key, as the device that claimed the request.

        Args:
            owner_id: The verified owner.
            enrollment_id: The request.
            device_id: The approving device.
            wrapped_key: The root key encrypted to the new device.

        Returns:
            The request, or ``None`` if it was not revealed, or was claimed
            by a different device.
        """
        return await self._one(
            owner_id, _APPROVE, (wrapped_key, enrollment_id, device_id)
        )

    async def reject(
        self, owner_id: UUID, enrollment_id: UUID, device_id: UUID
    ) -> Enrollment | None:
        """Refuse a request, as the device that claimed it.

        Args:
            owner_id: The verified owner.
            enrollment_id: The request.
            device_id: The approving device.

        Returns:
            The request, or ``None`` if this device had not claimed it or it
            was already finished.
        """
        return await self._one(owner_id, _REJECT, (enrollment_id, device_id))
