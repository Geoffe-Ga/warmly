"""FastAPI dependency that turns a bearer token into the request's owner."""

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from warmly.auth.verifier import (
    MISSING_TOKEN,
    AuthenticationError,
    Owner,
    TokenVerifier,
)

# auto_error is off so a missing token gets this API's own problem response
# instead of the framework's default body.
_bearer = HTTPBearer(
    scheme_name="bearerAuth",
    auto_error=False,
    bearerFormat="JWT",
    description="An access token from the auth provider.",
)


async def require_owner(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Owner:
    """Identify the caller from the ``Authorization: Bearer`` header.

    The owner comes only from the verified token's subject. No path, query,
    header or body field can name a different owner.

    Args:
        request: The current request; its application holds the verifier.
        credentials: The parsed header, or ``None`` if it is absent or not a
            bearer credential.

    Returns:
        The owner the request acts for.

    Raises:
        AuthenticationError: If there is no token or it is not acceptable.
    """
    if credentials is None:
        raise AuthenticationError(MISSING_TOKEN)
    verifier: TokenVerifier = request.app.state.token_verifier
    return await verifier.verify(credentials.credentials)


CurrentOwner = Annotated[Owner, Depends(require_owner)]
