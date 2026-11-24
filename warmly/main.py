"""ASGI entry point for the Warmly API.

Run locally with ``python -m warmly.main`` or point an ASGI server at
``warmly.main:app``.
"""

import uvicorn

from warmly.app import create_app

app = create_app()

DEV_HOST = "127.0.0.1"
DEV_PORT = 8000


def main() -> None:
    """Serve the API on the loopback interface for local development."""
    uvicorn.run("warmly.main:app", host=DEV_HOST, port=DEV_PORT)


if __name__ == "__main__":
    main()
