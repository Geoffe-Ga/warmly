"""A test device: a P-256 key pair that signs requests as the browser does.

The signature here is built independently of ``warmly.auth.device``: raw
``r || s``, base64, over the documented message. Agreement between the two is
what the tests check.
"""

import base64
import hashlib
import secrets
import time
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

import httpx2 as httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

DEVICE_ID = "d0000000-0000-4000-8000-00000000000a"
OTHER_DEVICE_ID = "d0000000-0000-4000-8000-00000000000b"
NAME_CIPHERTEXT = "bmFtZQ=="
# The sync protocol version a current client speaks.
SYNC_VERSION = "1"
# A synthetic account enrollment key pair, standing in for the one a client
# derives from its root key. The server is given only the public half.
ENROLLMENT_PRIVATE_KEY = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
ENROLLMENT_KEY = base64.b64encode(
    ENROLLMENT_PRIVATE_KEY.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
).decode()


def enrollment_proof(
    device_id: str,
    public_key: str,
    signer: Ed25519PrivateKey = ENROLLMENT_PRIVATE_KEY,
) -> str:
    """Compute the proof a device sends when it registers."""
    message = f"warmly-device-enrollment-v2\n{device_id}\n{public_key}".encode()
    return base64.b64encode(signer.sign(message)).decode()


@dataclass
class TestDevice:
    """A device identity for tests."""

    __test__ = False

    device_id: str = DEVICE_ID
    private_key: Any = field(
        default_factory=lambda: ec.generate_private_key(ec.SECP256R1())
    )

    @property
    def public_key(self) -> str:
        """Return the public key as the browser exports it: a raw point."""
        raw = self.private_key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return base64.b64encode(raw).decode()

    def registration(self, **overrides: Any) -> dict[str, Any]:
        """Return a valid body for ``POST /v1/devices``."""
        body = {
            "device_id": self.device_id,
            "public_key": self.public_key,
            "name_ciphertext": NAME_CIPHERTEXT,
            "enrollment_proof": enrollment_proof(self.device_id, self.public_key),
        }
        return body | overrides

    def headers(
        self,
        method: str,
        target: str,
        body: bytes = b"",
        *,
        timestamp: int | None = None,
        nonce: str | None = None,
        device_id: str | None = None,
    ) -> dict[str, str]:
        """Sign a request and return its signature headers and sync version."""
        stamp = str(int(time.time()) if timestamp is None else timestamp)
        used_nonce = secrets.token_urlsafe(18) if nonce is None else nonce
        named = self.device_id if device_id is None else device_id
        message = "\n".join(
            [
                "warmly-request-v1",
                method.upper(),
                target,
                hashlib.sha256(body).hexdigest(),
                stamp,
                used_nonce,
                named,
            ]
        ).encode()
        r, s = decode_dss_signature(
            self.private_key.sign(message, ec.ECDSA(hashes.SHA256()))
        )
        signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")
        return {
            "Warmly-Device": named,
            "Warmly-Timestamp": stamp,
            "Warmly-Nonce": used_nonce,
            "Warmly-Signature": base64.b64encode(signature).decode(),
            # Not part of the signature. The app says which sync version it
            # speaks; only the sync routes read it.
            "Warmly-Sync-Version": SYNC_VERSION,
        }


class DeviceAuth(httpx.Auth):
    """Signs every request a test client sends, as the app's API client does."""

    requires_request_body = True

    def __init__(self, device: TestDevice) -> None:
        """Sign as ``device``."""
        self.device = device

    def auth_flow(
        self, request: httpx.Request
    ) -> Generator[httpx.Request, httpx.Response, None]:
        """Add the signature headers unless the test set its own."""
        if "Warmly-Signature" not in request.headers:
            target = request.url.raw_path.decode("ascii")
            request.headers.update(
                self.device.headers(request.method, target, request.content)
            )
        yield request
