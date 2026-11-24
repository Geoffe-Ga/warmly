"""Marks responses that come from a stub rather than real behaviour.

Skeleton routes return fixed data and persist nothing. Each one sends the
``Warmly-Stub: true`` header so no client, test or operator can mistake a stub
for the real thing. An issue that implements a route removes this dependency.
"""

from fastapi import Response

STUB_HEADER = "Warmly-Stub"


def mark_stub(response: Response) -> None:
    """Add the stub marker header to the response.

    Args:
        response: The outgoing response, injected by FastAPI.
    """
    response.headers[STUB_HEADER] = "true"
