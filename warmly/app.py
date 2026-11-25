"""Application factory for the Warmly API."""

import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Protocol

from fastapi import FastAPI

from warmly import __version__
from warmly.api import API_PREFIX, build_api_router
from warmly.api.errors import install_error_handlers
from warmly.api.ports import DeviceStore, EnrollmentStore, RecoveryStore, SyncStore
from warmly.api.rate_limit import RateLimiter, RateLimits, RequestCounters
from warmly.auth.device import DeviceVerifier
from warmly.auth.keys import remote_key_source
from warmly.auth.verifier import TokenVerifier
from warmly.config import Settings, load_settings
from warmly.db.database import Database
from warmly.db.device_store import PostgresDeviceStore
from warmly.db.enrollment_store import PostgresEnrollmentStore
from warmly.db.rate_limit_store import PostgresRateLimitStore
from warmly.db.recovery_store import OwnerTransactions, PostgresRecoveryStore
from warmly.db.sync_store import PostgresSyncStore
from warmly.middleware.body_limit import BodyLimitMiddleware
from warmly.middleware.request_log import RequestLogMiddleware
from warmly.middleware.security_headers import SecurityHeadersMiddleware
from warmly.schemas.sync import SYNC_VERSION_MAX, SYNC_VERSION_MIN

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


def _attach_stores(
    app: FastAPI,
    database: DatabaseLike,
    *,
    recovery_store: RecoveryStore | None,
    device_store: DeviceStore | None,
    enrollment_store: EnrollmentStore | None,
    sync_store: SyncStore | None,
) -> None:
    """Give the application its stores: the ones passed in, or the database's.

    Args:
        app: The application being built.
        database: Where the default stores keep their data.
        recovery_store: Used instead of the recovery-envelope table.
        device_store: Used instead of the device tables.
        enrollment_store: Used instead of the pairing-request table.
        sync_store: Used instead of the synced-record tables.
    """
    app.state.recovery_store = recovery_store or PostgresRecoveryStore(database)
    app.state.device_store = device_store or PostgresDeviceStore(database)
    app.state.enrollment_store = enrollment_store or PostgresEnrollmentStore(database)
    app.state.sync_store = sync_store or PostgresSyncStore(database)


def create_app(
    settings: Settings | None = None,
    *,
    database: DatabaseLike | None = None,
    token_verifier: TokenVerifier | None = None,
    recovery_store: RecoveryStore | None = None,
    device_store: DeviceStore | None = None,
    enrollment_store: EnrollmentStore | None = None,
    sync_store: SyncStore | None = None,
    request_counters: RequestCounters | None = None,
    rate_limits: RateLimits | None = None,
    sync_versions: tuple[int, int] = (SYNC_VERSION_MIN, SYNC_VERSION_MAX),
    clock: Callable[[], float] = time.time,
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
        device_store: Where devices and used nonces are kept, instead of the
            database tables.
        enrollment_store: Where device pairing requests are kept, instead of
            the database table.
        sync_store: Where synced records are kept, instead of the database
            tables.
        request_counters: Where requests are counted for rate limiting,
            instead of the database table.
        rate_limits: How many requests an account and a device may make.
        sync_versions: The oldest and newest sync protocol versions to
            accept. Tests pass a different range to stand in for a server
            that has moved on.
        clock: Seconds since the epoch, for judging request timestamps and
            rate-limit windows.

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
    _attach_stores(
        app,
        database,
        recovery_store=recovery_store,
        device_store=device_store,
        enrollment_store=enrollment_store,
        sync_store=sync_store,
    )
    app.state.clock = clock
    app.state.sync_versions = sync_versions
    app.state.rate_limiter = RateLimiter(
        request_counters or PostgresRateLimitStore(database),
        rate_limits or RateLimits(),
        clock,
    )
    app.state.device_verifier = DeviceVerifier(app.state.device_store, clock=clock)
    install_error_handlers(app)
    app.include_router(build_api_router({"database": database.ping}))
    # Starlette runs the middleware added last first. Order, outermost first:
    # log every request, add security headers to every response, then refuse
    # oversized bodies before the application parses them.
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLogMiddleware)
    return app
