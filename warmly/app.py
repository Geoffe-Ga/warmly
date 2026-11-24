"""Application factory for the Warmly API."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol

from fastapi import FastAPI

from warmly import __version__
from warmly.api import API_PREFIX, build_api_router
from warmly.api.errors import install_error_handlers
from warmly.api.ports import RecoveryStore
from warmly.auth.keys import remote_key_source
from warmly.auth.verifier import TokenVerifier
from warmly.config import Settings, load_settings
from warmly.db.database import Database
from warmly.db.recovery_store import OwnerTransactions, PostgresRecoveryStore
from warmly.middleware.body_limit import BodyLimitMiddleware
from warmly.middleware.request_log import RequestLogMiddleware
from warmly.middleware.security_headers import SecurityHeadersMiddleware

API_TITLE = "Warmly API"
API_DESCRIPTION = (
    "Owner-scoped ciphertext sync for the Warmly PWA. Every content field is "
    "encrypted on the client; this service never receives plaintext."
)


class DatabaseLike(OwnerTransactions, Protocol):
    """What the application needs from its database handle."""

    async def open(self) -> None:
        """Start the connection pool."""

    async def close(self) -> None:
        """Close the connection pool."""

    async def ping(self) -> bool:
        """Report whether a query can be run."""


def _verifier_from(settings: Settings) -> TokenVerifier:
    """Build the verifier for the configured auth provider.

    No key is fetched here; that happens when the first token arrives.
    """
    return TokenVerifier(
        issuer=settings.auth_issuer,
        audience=settings.auth_audience,
        keys=remote_key_source(settings.auth_jwks_url),
    )


def create_app(
    settings: Settings | None = None,
    *,
    database: DatabaseLike | None = None,
    token_verifier: TokenVerifier | None = None,
    recovery_store: RecoveryStore | None = None,
) -> FastAPI:
    """Build the FastAPI application.

    Interactive documentation pages are disabled because they load scripts
    from a third-party CDN. The machine-readable contract is served at
    ``/v1/openapi.json`` and committed to ``openapi/warmly.v1.json``.

    Args:
        settings: Configuration to use; read from the environment if omitted.
        database: Database handle to use instead of one built from the
            settings. Tests pass a double here.
        token_verifier: Verifier to use instead of one built from the
            settings. Tests pass one that trusts a locally generated key.
        recovery_store: Where recovery envelopes are kept, instead of the
            database table. Tests that run without a database pass a double.

    Returns:
        The configured application.
    """
    if database is None or token_verifier is None:
        loaded = settings or load_settings()
        if database is None:
            database = Database(loaded.database_url)
        if token_verifier is None:
            token_verifier = _verifier_from(loaded)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        """Open the connection pool for the life of the application."""
        await database.open()
        try:
            yield
        finally:
            await database.close()

    app = FastAPI(
        title=API_TITLE,
        description=API_DESCRIPTION,
        version=__version__,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.token_verifier = token_verifier
    app.state.recovery_store = recovery_store or PostgresRecoveryStore(database)
    install_error_handlers(app)
    app.include_router(build_api_router({"database": database.ping}))
    # Starlette runs the middleware added last first. Order, outermost first:
    # log every request, add security headers to every response, then refuse
    # oversized bodies before the application parses them.
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLogMiddleware)
    return app
