"""Application factory for the Warmly API."""

from fastapi import FastAPI

from warmly import __version__
from warmly.api import API_PREFIX, build_api_router
from warmly.api.errors import install_error_handlers
from warmly.middleware.body_limit import BodyLimitMiddleware
from warmly.middleware.request_log import RequestLogMiddleware
from warmly.middleware.security_headers import SecurityHeadersMiddleware

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
    # Starlette runs the middleware added last first. Order, outermost first:
    # log every request, add security headers to every response, then refuse
    # oversized bodies before the application parses them.
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLogMiddleware)
    return app
