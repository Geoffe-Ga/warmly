"""Middleware only acts on HTTP; other ASGI scopes pass straight through."""

import asyncio

import pytest
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from warmly.middleware.body_limit import BodyLimitMiddleware
from warmly.middleware.request_log import RequestLogMiddleware
from warmly.middleware.security_headers import SecurityHeadersMiddleware


@pytest.mark.parametrize(
    "middleware",
    [BodyLimitMiddleware, RequestLogMiddleware, SecurityHeadersMiddleware],
    ids=lambda cls: cls.__name__,
)
def test_non_http_scopes_reach_the_app_untouched(
    middleware: type, caplog: pytest.LogCaptureFixture
) -> None:
    """Lifespan events are forwarded with the original channels."""
    seen: list[tuple[str, Receive, Send]] = []

    async def inner(scope: Scope, receive: Receive, send: Send) -> None:
        """Record what the wrapped application was called with."""
        seen.append((scope["type"], receive, send))

    async def receive() -> Message:
        """Supply a lifespan event."""
        return {"type": "lifespan.startup"}

    async def send(_message: Message) -> None:
        """Discard outgoing events."""

    async def run() -> None:
        """Drive the middleware with a lifespan scope."""
        wrapped: ASGIApp = middleware(inner)
        await wrapped({"type": "lifespan"}, receive, send)

    asyncio.run(run())

    assert seen == [("lifespan", receive, send)]
    assert not caplog.records
