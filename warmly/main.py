"""ASGI entry point for the Warmly API.

Run locally with ``python -m warmly.main`` or point an ASGI server at
``warmly.main:app``.
"""

import uvicorn

from warmly.app import create_app
from warmly.logs import configure_logging

app = create_app()

DEV_HOST = "127.0.0.1"
DEV_PORT = 8000


def main() -> None:
    """Serve the API on the loopback interface for local development.

    Uvicorn's own access log is turned off because it records the concrete
    path and query string. ``RequestLogMiddleware`` logs each request instead,
    using the route template only.
    """
    configure_logging()
    uvicorn.run("warmly.main:app", host=DEV_HOST, port=DEV_PORT, access_log=False)


if __name__ == "__main__":
    main()
