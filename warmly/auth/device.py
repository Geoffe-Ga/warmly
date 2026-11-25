"""Which device is calling: verifies request signatures (ADR-0005, D-06).

A session token says who the user is. It does not say which device is
speaking, and a stolen token would otherwise be enough to act as the account.
So every request is also signed by a key that never leaves the device, and
the signature is checked here against the public key that device registered.

The signature covers the method, the path and query, a hash of the body, a
timestamp and a nonce. A request that was altered, is too old, or repeats a
nonce is refused.
"""

import base64
import binascii
import hashlib
import hmac
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, Protocol
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi import Depends, Request

from warmly.auth.dependency import CurrentOwner
from warmly.auth.verifier import Owner

DEVICE_HEADER = "Warmly-Device"
TIMESTAMP_HEADER = "Warmly-Timestamp"
NONCE_HEADER = "Warmly-Nonce"
SIGNATURE_HEADER = "Warmly-Signature"

# First line of every signed message. Changing what is signed means a new
# version here, so an old signature can never be read under new rules.
SIGNATURE_VERSION = "warmly-request-v1"
ENROLLMENT_PROOF_VERSION = "warmly-device-enrollment-v1"

# How far a request's timestamp may be from the server's clock, either way.
MAX_CLOCK_SKEW_SECONDS = 300
_MIN_NONCE_CHARS = 16
_MAX_NONCE_CHARS = 64
# An uncompressed P-256 point, and a raw r||s signature over it.
_PUBLIC_KEY_BYTES = 65
_SIGNATURE_BYTES = 64
_HALF = _SIGNATURE_BYTES // 2

DeviceErrorCode = Literal[
    "device.missing_signature", "device.stale_request", "device.not_authorized"
]

MISSING_SIGNATURE: DeviceErrorCode = "device.missing_signature"
STALE_REQUEST: DeviceErrorCode = "device.stale_request"
NOT_AUTHORIZED: DeviceErrorCode = "device.not_authorized"


class DeviceAuthorizationError(Exception):
    """Raised when a request is not acceptably signed by one of the owner's devices."""

    def __init__(self, code: DeviceErrorCode) -> None:
        """Create the error.

        Args:
            code: The stable code sent to the client.
        """
        super().__init__(code)
        self.code: DeviceErrorCode = code


class RegisteredDevice(Protocol):
    """What the server knows about a device, for checking its requests.

    A protocol, so the storage layer below can return its own record type
    without importing from this one.
    """

    @property
    def public_key(self) -> str:
        """The device's registered public key, base64."""

    @property
    def revoked(self) -> bool:
        """Whether the device has been revoked."""


@dataclass(frozen=True)
class Caller:
    """The account and the device a request acts for, both verified."""

    owner: Owner
    device_id: UUID


class DeviceKeys(Protocol):
    """Looks up devices and remembers used nonces, always for one owner."""

    async def find(self, owner_id: UUID, device_id: UUID) -> RegisteredDevice | None:
        """Return the owner's device with this ID, or ``None``."""

    async def use_nonce(
        self, owner_id: UUID, device_id: UUID, nonce: str, expires_at: datetime
    ) -> bool:
        """Record a nonce. Return ``False`` if it was already used."""


@dataclass(frozen=True)
class SignedRequest:
    """A request as received: what its signature covers, and the signature."""

    method: str
    target: str
    body: bytes
    device_id: str
    timestamp: str
    nonce: str
    signature: str

    def message(self) -> bytes:
        """Return the exact bytes the device signed."""
        return "\n".join(
            [
                SIGNATURE_VERSION,
                self.method.upper(),
                self.target,
                hashlib.sha256(self.body).hexdigest(),
                self.timestamp,
                self.nonce,
                self.device_id,
            ]
        ).encode()


def decode_base64(value: str, length: int) -> bytes | None:
    """Decode strict standard base64 of an exact decoded length.

    Args:
        value: The text to decode.
        length: The number of bytes the value must decode to.

    Returns:
        The bytes, or ``None`` if the text is not base64 of that length.
    """
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None
    return decoded if len(decoded) == length else None


def load_public_key(encoded: str) -> ec.EllipticCurvePublicKey | None:
    """Read a device public key: a base64 uncompressed P-256 point.

    Args:
        encoded: The key as registered.

    Returns:
        The key, or ``None`` if it is not a valid point on the curve.
    """
    raw = decode_base64(encoded, _PUBLIC_KEY_BYTES)
    if raw is None:
        return None
    try:
        return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    except ValueError:
        return None


def signature_is_valid(public_key: str, message: bytes, signature: str) -> bool:
    """Check an ECDSA P-256 SHA-256 signature in the browser's raw form.

    Browsers produce ``r || s`` as two 32-byte numbers; the verifier here
    wants DER, so the two halves are re-encoded.

    Args:
        public_key: The device's registered key.
        message: The bytes that were signed.
        signature: Base64 of the 64-byte signature.

    Returns:
        Whether the signature is valid for the message under the key.
    """
    key = load_public_key(public_key)
    raw = decode_base64(signature, _SIGNATURE_BYTES)
    if key is None or raw is None:
        return False
    der = encode_dss_signature(
        int.from_bytes(raw[:_HALF], "big"), int.from_bytes(raw[_HALF:], "big")
    )
    try:
        key.verify(der, message, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        return False
    return True


def enrollment_proof_is_valid(
    verifier: str, device_id: UUID, public_key: str, proof: str
) -> bool:
    """Check that whoever is registering a device knows the account root key.

    The proof is ``HMAC-SHA-256(verifier, version | device ID | public key)``,
    where the verifier is derived one-way from the root key. A stolen session
    token cannot produce it.

    Args:
        verifier: The account's enrollment verifier, base64.
        device_id: The device being registered.
        public_key: The key it is registering.
        proof: Base64 of the 32-byte HMAC.

    Returns:
        Whether the proof matches.
    """
    key = decode_base64(verifier, hashlib.sha256().digest_size)
    given = decode_base64(proof, hashlib.sha256().digest_size)
    if key is None or given is None:
        return False
    message = "\n".join([ENROLLMENT_PROOF_VERSION, str(device_id), public_key])
    expected = hmac.new(key, message.encode(), hashlib.sha256).digest()
    return hmac.compare_digest(expected, given)


class DeviceVerifier:
    """Checks that a request was signed, recently and once, by a known device."""

    def __init__(
        self, devices: DeviceKeys, *, clock: Callable[[], float] = time.time
    ) -> None:
        """Create the verifier.

        Args:
            devices: Where devices and used nonces are kept.
            clock: Seconds since the epoch; tests pass their own.
        """
        self._devices = devices
        self._clock = clock

    def check_timestamp(self, timestamp: str) -> None:
        """Refuse a request whose timestamp is missing, malformed or too old.

        Args:
            timestamp: The timestamp header: whole seconds since the epoch.

        Raises:
            DeviceAuthorizationError: ``device.stale_request``.
        """
        if not timestamp.isascii() or not timestamp.isdigit():
            raise DeviceAuthorizationError(STALE_REQUEST)
        if abs(self._clock() - int(timestamp)) > MAX_CLOCK_SKEW_SECONDS:
            raise DeviceAuthorizationError(STALE_REQUEST)

    async def verify(self, owner: Owner, signed: SignedRequest) -> Caller:
        """Verify a signed request and name the device that sent it.

        The checks run in this order so that nothing is stored for a request
        that was not really signed by the device: shape, freshness, the
        device, the signature, and only then the nonce.

        Args:
            owner: The verified account.
            signed: The request as received.

        Returns:
            The account and device the request acts for.

        Raises:
            DeviceAuthorizationError: If the request is not acceptable.
        """
        try:
            device_id = UUID(signed.device_id)
        except ValueError:
            raise DeviceAuthorizationError(NOT_AUTHORIZED) from None
        if not (
            _MIN_NONCE_CHARS <= len(signed.nonce) <= _MAX_NONCE_CHARS
            and signed.nonce.isascii()
            and signed.nonce.isprintable()
        ):
            raise DeviceAuthorizationError(NOT_AUTHORIZED)
        self.check_timestamp(signed.timestamp)
        # A device that belongs to another account is simply not found here,
        # so it is refused exactly like one that does not exist (DEV-010).
        device = await self._devices.find(owner.id, device_id)
        if device is None or device.revoked:
            raise DeviceAuthorizationError(NOT_AUTHORIZED)
        if not signature_is_valid(
            device.public_key, signed.message(), signed.signature
        ):
            raise DeviceAuthorizationError(NOT_AUTHORIZED)
        expires_at = datetime.fromtimestamp(int(signed.timestamp), tz=UTC) + timedelta(
            seconds=2 * MAX_CLOCK_SKEW_SECONDS
        )
        if not await self._devices.use_nonce(
            owner.id, device_id, signed.nonce, expires_at
        ):
            raise DeviceAuthorizationError(NOT_AUTHORIZED)
        return Caller(owner=owner, device_id=device_id)


def _target(request: Request) -> str:
    """Return the path and query exactly as the client sent them.

    The app only ever sends ASCII here: anything else is percent-encoded by
    the browser. Raw bytes outside ASCII therefore cannot belong to a request
    the app signed, and are refused rather than guessed at.

    Raises:
        DeviceAuthorizationError: ``device.not_authorized`` if the path or
            query holds a byte that is not ASCII.
    """
    try:
        path = request.scope["raw_path"].decode("ascii")
        query = request.scope["query_string"].decode("ascii")
    except UnicodeDecodeError:
        raise DeviceAuthorizationError(NOT_AUTHORIZED) from None
    return f"{path}?{query}" if query else path


async def read_signed_request(request: Request) -> SignedRequest:
    """Collect what a request's signature covers, and the signature itself.

    Args:
        request: The current request.

    Returns:
        The signed parts and the signature.

    Raises:
        DeviceAuthorizationError: ``device.missing_signature`` if any of the
            four headers is absent, and ``device.not_authorized`` if the
            path or query is not ASCII.
    """
    headers = request.headers
    values = [
        headers.get(name)
        for name in (DEVICE_HEADER, TIMESTAMP_HEADER, NONCE_HEADER, SIGNATURE_HEADER)
    ]
    if any(value is None or not value for value in values):
        raise DeviceAuthorizationError(MISSING_SIGNATURE)
    device_id, timestamp, nonce, signature = (str(value) for value in values)
    return SignedRequest(
        method=request.method,
        target=_target(request),
        body=await request.body(),
        device_id=device_id,
        timestamp=timestamp,
        nonce=nonce,
        signature=signature,
    )


async def require_device(request: Request, owner: CurrentOwner) -> Caller:
    """Identify the calling device from the request's signature.

    Applied to every route that needs a signed-in caller, apart from the few
    a device must be able to reach before it is registered.

    Args:
        request: The current request; its application holds the verifier.
        owner: The verified account.

    Returns:
        The account and device the request acts for.

    Raises:
        DeviceAuthorizationError: If the request is unsigned or the signature
            is not acceptable.
    """
    verifier: DeviceVerifier = request.app.state.device_verifier
    return await verifier.verify(owner, await read_signed_request(request))


CurrentCaller = Annotated[Caller, Depends(require_device)]
