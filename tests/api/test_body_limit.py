"""Oversized request bodies are refused before they are parsed."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.app import create_app
from warmly.middleware.body_limit import (
    MAX_BODY_BYTES,
    BodyLimitMiddleware,
    BodyTooLargeError,
)
from warmly.middleware.security_headers import SECURITY_HEADERS

LIMIT = 64


async def _echo(scope: Scope, receive: Receive, send: Send) -> None:
    """Read the whole request body and reply with its size as JSON."""
    size = 0
    while True:
        message = await receive()
        size += len(message.get("body", b""))
        if not message.get("more_body", False):
            break
    await JSONResponse({"size": size})(scope, receive, send)


def _echo_app() -> ASGIApp:
    """Wrap the echo application in a small body limit."""
    return BodyLimitMiddleware(_echo, max_bytes=LIMIT)


def _chunks(total: int, size: int = 16) -> Iterator[bytes]:
    """Yield ``total`` bytes in pieces, so no Content-Length is sent."""
    sent = 0
    while sent < total:
        piece = min(size, total - sent)
        yield b"x" * piece
        sent += piece


def test_body_at_the_limit_is_accepted() -> None:
    """The limit is inclusive."""
    response = TestClient(_echo_app()).post("/upload", content=b"x" * LIMIT)

    assert response.status_code == 200
    assert response.json() == {"size": LIMIT}


def test_body_one_byte_over_is_a_413_problem() -> None:
    """A declared length above the limit is refused without reading the body."""
    response = TestClient(_echo_app()).post("/upload", content=b"x" * (LIMIT + 1))

    assert response.status_code == 413
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json() == {
        "type": "about:blank",
        "title": "Request body too large",
        "status": 413,
        "code": "request.too_large",
        "errors": [],
    }


def test_streamed_body_without_content_length_is_counted() -> None:
    """A missing Content-Length cannot be used to get past the cap."""
    client = TestClient(_echo_app())

    within = client.post("/upload", content=_chunks(LIMIT))
    over = client.post("/upload", content=_chunks(LIMIT + 1))

    assert "content-length" not in within.request.headers
    assert within.json() == {"size": LIMIT}
    assert over.status_code == 413
    assert over.json()["code"] == "request.too_large"


def test_understated_content_length_is_still_caught() -> None:
    """The byte count is enforced even when the header lies."""
    sent: list[Message] = []
    messages = [
        {"type": "http.request", "body": b"x" * LIMIT, "more_body": True},
        {"type": "http.request", "body": b"x", "more_body": False},
    ]

    async def receive() -> Message:
        """Deliver the body in two parts, more than the header declared."""
        return messages.pop(0)

    async def send(message: Message) -> None:
        """Collect the response events."""
        sent.append(message)

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/upload",
        "raw_path": b"/upload",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-length", b"1")],
        "client": ("testclient", 1),
        "server": ("testserver", 80),
    }

    async def run() -> None:
        """Drive the application with the hand-built request."""
        await _echo_app()(scope, receive, send)

    asyncio.run(run())

    assert sent[0]["status"] == 413


def test_overflow_after_the_response_started_is_not_hidden() -> None:
    """If a response is already going out, the failure propagates."""

    async def eager_app(_scope: Scope, receive: Receive, send: Send) -> None:
        """Start responding before reading the body."""
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await receive()

    async def receive() -> Message:
        """Deliver a body that is over the limit."""
        return {"type": "http.request", "body": b"x" * (LIMIT + 1), "more_body": False}

    async def send(_message: Message) -> None:
        """Discard outgoing events."""

    async def run() -> None:
        """Drive the middleware around the eager application."""
        middleware = BodyLimitMiddleware(eager_app, max_bytes=LIMIT)
        await middleware({"type": "http", "headers": []}, receive, send)

    with pytest.raises(BodyTooLargeError):
        asyncio.run(run())


def test_the_real_app_refuses_an_oversized_request_with_security_headers() -> None:
    """The cap is installed on the application and errors still get headers."""
    response = TestClient(create_app()).post(
        "/v1/sync/operations",
        content=b"x" * (MAX_BODY_BYTES + 1),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json()["code"] == "request.too_large"
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


def test_malformed_content_length_falls_back_to_counting() -> None:
    """A non-numeric header is ignored and the bytes are counted instead."""
    response = TestClient(_echo_app()).post(
        "/upload", content=_chunks(LIMIT + 1), headers={"content-length": "abc"}
    )

    assert response.status_code in {400, 413}
