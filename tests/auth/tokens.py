"""Sign access tokens with a locally generated key pair.

No test contacts a real auth provider. The verifier under test is given the
public half of a key made here, exactly as the provider would publish it.
"""

import json
import time
from dataclasses import dataclass, field
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

ISSUER = "https://auth.example.test/auth/v1"
AUDIENCE = "authenticated"
OWNER_ID = "0a1b2c3d-0000-4000-8000-00000000000a"
OTHER_OWNER_ID = "0a1b2c3d-0000-4000-8000-00000000000b"
KEY_ID = "test-key-1"

_REMOVE = object()


@dataclass
class Signer:
    """A key pair that signs tokens and publishes its public half."""

    key_id: str = KEY_ID
    algorithm: str = "ES256"
    private_key: Any = field(default=None)

    def __post_init__(self) -> None:
        """Generate the key pair unless one was supplied."""
        if self.private_key is None:
            self.private_key = (
                ec.generate_private_key(ec.SECP256R1())
                if self.algorithm == "ES256"
                else rsa.generate_private_key(public_exponent=65537, key_size=2048)
            )

    def jwk(self) -> dict[str, Any]:
        """Return the public key as the provider would publish it."""
        public_key = self.private_key.public_key()
        encoded = (
            ECAlgorithm.to_jwk(public_key)
            if self.algorithm == "ES256"
            else RSAAlgorithm.to_jwk(public_key)
        )
        jwk: dict[str, Any] = json.loads(encoded)
        return jwk | {"kid": self.key_id, "alg": self.algorithm, "use": "sig"}

    def token(self, headers: dict[str, Any] | None = None, **claims: Any) -> str:
        """Sign a token. Keyword arguments override or, with REMOVE, drop claims.

        Args:
            headers: Extra or replacement JOSE header fields.
            **claims: Claim overrides.

        Returns:
            The compact JWT.
        """
        now = int(time.time())
        payload: dict[str, Any] = {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": OWNER_ID,
            "iat": now,
            "exp": now + 3600,
            "role": "authenticated",
            "aal": "aal1",
            "session_id": "5e55105e-0000-4000-8000-000000000001",
            "email": "person@example.test",
            "is_anonymous": False,
            "user_metadata": {"email_verified": True},
        } | claims
        payload = {k: v for k, v in payload.items() if v is not _REMOVE}
        return jwt.encode(
            payload,
            self.private_key,
            algorithm=self.algorithm,
            headers={"kid": self.key_id, **(headers or {})},
        )


REMOVE: Any = _REMOVE
