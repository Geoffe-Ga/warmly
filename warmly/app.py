"""Application factory for the Warmly API."""

from fastapi import FastAPI

from warmly import __version__
from warmly.api import API_PREFIX, build_api_router
from warmly.api.errors import install_error_handlers

API_TITLE = "Warmly API"
API_DESCRIPTION = (
    "Owner-scoped ciphertext sync for the Warmly PWA. Every content field is "
    "encrypted on the client; this service never receives plaintext."
)


def create_app() -> FastAPI:
    """Build the FastAPI application.

    Interactive documentation pages are disabled because they load scripts
    from a third-party CDN. The machine-readable contract is served at
    ``/v1/openapi.json`` and committed to ``openapi/warmly.v1.json``.

    Returns:
        The configured application.
    """
    app = FastAPI(
        title=API_TITLE,
        description=API_DESCRIPTION,
        version=__version__,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=None,
        redoc_url=None,
    )
    install_error_handlers(app)
    app.include_router(build_api_router())
    return app
