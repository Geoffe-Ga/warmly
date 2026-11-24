"""Application factory for the Warmly API."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol

from fastapi import FastAPI

from warmly import __version__
from warmly.api import API_PREFIX, build_api_router
from warmly.api.errors import install_error_handlers
from warmly.config import Settings, load_settings
from warmly.db.database import Database
from warmly.middleware.body_limit import BodyLimitMiddleware
from warmly.middleware.request_log import RequestLogMiddleware
from warmly.middleware.security_headers import SecurityHeadersMiddleware

API_TITLE = "Warmly API"
API_DESCRIPTION = (
    "Owner-scoped ciphertext sync for the Warmly PWA. Every content field is "
    "encrypted on the client; this service never receives plaintext."
)


class DatabaseLike(Protocol):
    """What the application needs from its database handle."""

    async def open(self) -> None:
        """Start the connection pool."""

    async def close(self) -> None:
        """Close the connection pool."""

    async def ping(self) -> bool:
        """Report whether a query can be run."""


def create_app(
    settings: Settings | None = None, *, database: DatabaseLike | None = None
) -> FastAPI:
    """Build the FastAPI application.

    Interactive documentation pages are disabled because they load scripts
    from a third-party CDN. The machine-readable contract is served at
    ``/v1/openapi.json`` and committed to ``openapi/warmly.v1.json``.

    Args:
        settings: Configuration to use; read from the environment if omitted.
        database: Database handle to use instead of one built from the
            settings. Tests pass a double here.

    Returns:
        The configured application.
    """
    if database is None:
        database = Database((settings or load_settings()).database_url)

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
    install_error_handlers(app)
    app.include_router(build_api_router({"database": database.ping}))
    # Starlette runs the middleware added last first. Order, outermost first:
    # log every request, add security headers to every response, then refuse
    # oversized bodies before the application parses them.
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLogMiddleware)
    return app
