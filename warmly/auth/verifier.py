"""Verify an access token and name its owner.

Every check fails closed. The reason a token was refused is never sent to the
caller in any more detail than a short, fixed code.
"""

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

import jwt
from jwt.exceptions import PyJWTError

from warmly.auth.keys import ALLOWED_ALGORITHMS, KeySource

AuthErrorCode = Literal[
    "auth.missing_token", "auth.invalid_token", "auth.email_not_verified"
]

# Access tokens are about a kilobyte. Refuse anything far larger unparsed.
MAX_TOKEN_LENGTH = 8192
# Allowance for clock difference between the auth provider and this server.
LEEWAY_SECONDS = 30
_SIGNED_IN_ROLE = "authenticated"
# `nbf` is honoured when present but not required: the provider does not
# always send it, and `iat` plus `exp` already bound the token's lifetime.
_REQUIRED_CLAIMS = ("exp", "iat", "iss", "aud", "sub")


MISSING_TOKEN: AuthErrorCode = "auth.missing_token"
INVALID_TOKEN: AuthErrorCode = "auth.invalid_token"
EMAIL_NOT_VERIFIED: AuthErrorCode = "auth.email_not_verified"


class AuthenticationError(Exception):
    """Raised when a request does not carry an acceptable token."""

    def __init__(self, code: AuthErrorCode) -> None:
        """Create the failure.

        Args:
            code: The stable code sent to the client.
        """
        super().__init__(code)
        self.code: AuthErrorCode = code


@dataclass(frozen=True)
class Owner:
    """The account a request acts for, taken from a verified token."""

    id: UUID


def _invalid() -> AuthenticationError:
    """Build the one failure used for every unacceptable token."""
    return AuthenticationError(INVALID_TOKEN)


def _email_is_verified(claims: dict[str, object]) -> bool:
    """Report whether the token says the account's email is confirmed.

    This claim is defence in depth. The control that matters is the auth
    provider's "confirm email" setting, which stops an unconfirmed account
    from getting a token at all; see docs/security/authentication.md.
    """
    metadata = claims.get("user_metadata")
    return isinstance(metadata, dict) and metadata.get("email_verified") is True


class TokenVerifier:
    """Checks access tokens from one issuer for one audience."""

    def __init__(self, *, issuer: str, audience: str, keys: KeySource) -> None:
        """Create the verifier.

        Args:
            issuer: The exact ``iss`` a token must carry.
            audience: The ``aud`` a token must include.
            keys: Where verification keys come from.
        """
        self._issuer = issuer
        self._audience = audience
        self._keys = keys

    async def _claims(self, token: str) -> dict[str, object]:
        """Check the signature and the standard claims, and return the claims.

        Raises:
            AuthenticationError: If anything about the token is unacceptable.
        """
        if len(token) > MAX_TOKEN_LENGTH:
            raise _invalid()
        try:
            header = jwt.get_unverified_header(token)
        except PyJWTError:
            raise _invalid() from None
        key_id = header.get("kid")
        if header.get("alg") not in ALLOWED_ALGORITHMS or not isinstance(key_id, str):
            raise _invalid()
        key = await self._keys.key_for(key_id)
        if key is None:
            raise _invalid()
        try:
            claims: dict[str, object] = jwt.decode(
                token,
                key=key,
                algorithms=list(ALLOWED_ALGORITHMS),
                audience=self._audience,
                issuer=self._issuer,
                leeway=LEEWAY_SECONDS,
                options={"require": list(_REQUIRED_CLAIMS)},
            )
        except PyJWTError:
            raise _invalid() from None
        return claims

    async def verify(self, token: str) -> Owner:
        """Verify a token and return the account it belongs to.

        Args:
            token: The compact JWT from the ``Authorization`` header.

        Returns:
            The owner named by the token's subject.

        Raises:
            AuthenticationError: If the token is malformed, expired, signed by an
                unknown key, from another issuer or for another audience, is
                not for a signed-in user, or the email is not verified.
            KeysUnavailableError: If the signing keys cannot be fetched.
        """
        claims = await self._claims(token)
        if claims.get("role") != _SIGNED_IN_ROLE or claims.get("is_anonymous") is True:
            raise _invalid()
        try:
            owner_id = UUID(str(claims["sub"]))
        except ValueError:
            raise _invalid() from None
        if not _email_is_verified(claims):
            raise AuthenticationError(EMAIL_NOT_VERIFIED)
        return Owner(id=owner_id)
