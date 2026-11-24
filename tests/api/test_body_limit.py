"""Oversized request bodies are refused before they are parsed."""

import asyncio
from collections.abc import Callable, Iterator
from typing import Annotated

import pytest
from fastapi import Body, FastAPI
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from warmly.api.errors import PROBLEM_MEDIA_TYPE, install_error_handlers
from warmly.app import create_app
from warmly.middleware.body_limit import MAX_BODY_BYTES, BodyLimitMiddleware
from warmly.middleware.security_headers import SECURITY_HEADERS

LIMIT = 64
TOO_LARGE = {
    "type": "about:blank",
    "title": "Request body too large",
    "status": 413,
    "code": "request.too_large",
    "errors": [],
}


async def _echo(scope: Scope, receive: Receive, send: Send) -> None:
    """Read the whole request body and reply with its size as JSON."""
    size = 0
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            return
        size += len(message.get("body", b""))
        if not message.get("more_body", False):
            break
    await JSONResponse({"size": size})(scope, receive, send)


def _raw_app() -> ASGIApp:
    """A bare ASGI application behind a small body limit."""
    return BodyLimitMiddleware(_echo, max_bytes=LIMIT)


def _framework_app() -> FastAPI:
    """A real FastAPI route that parses a JSON body, behind a small limit.

    FastAPI reads and parses the body itself and has its own handling for
    failures while doing so. This is the case that matters in production.
    """
    app = FastAPI()
    install_error_handlers(app)

    @app.post("/items")
    def create_item(payload: Annotated[dict[str, str], Body()]) -> dict[str, int]:
        """Report how many keys the parsed body had."""
        return {"keys": len(payload)}

    app.add_middleware(BodyLimitMiddleware, max_bytes=LIMIT)
    return app


# Each behaviour is checked on a bare ASGI application and on a real FastAPI
# route, which reads and parses the body itself.
APPS: list[tuple[Callable[[], ASGIApp], str]] = [
    (_raw_app, "/"),
    (_framework_app, "/items"),
]


def _chunks(data: bytes, size: int = 16) -> Iterator[bytes]:
    """Yield ``data`` in pieces, so the client sends no Content-Length."""
    for start in range(0, len(data), size):
        yield data[start : start + size]


def _json_of(length: int) -> bytes:
    """Return a valid JSON object exactly ``length`` bytes long."""
    padding = length - len(b'{"k":""}')
    return b'{"k":"' + b"x" * padding + b'"}'


@pytest.mark.parametrize(("app_factory", "path"), APPS)
def test_body_at_the_limit_is_accepted(
    app_factory: Callable[[], ASGIApp], path: str
) -> None:
    """The limit is inclusive."""
    response = TestClient(app_factory()).post(
        path, content=_json_of(LIMIT), headers={"content-type": "application/json"}
    )

    assert response.status_code == 200


@pytest.mark.parametrize(("app_factory", "path"), APPS)
def test_declared_length_over_the_limit_is_a_413_problem(
    app_factory: Callable[[], ASGIApp], path: str
) -> None:
    """A declared length above the limit is refused without reading the body."""
    response = TestClient(app_factory()).post(
        path,
        content=_json_of(LIMIT + 1),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json() == TOO_LARGE


@pytest.mark.parametrize(("app_factory", "path"), APPS)
def test_streamed_body_over_the_limit_is_a_413_problem(
    app_factory: Callable[[], ASGIApp], path: str
) -> None:
    """With no Content-Length the bytes are counted, and the answer is still 413.

    This includes a real FastAPI route: the refusal must not be turned into a
    400 or a 500 by the framework's own body-reading error handling.
    """
    client = TestClient(app_factory())
    headers = {"content-type": "application/json"}

    within = client.post(path, content=_chunks(_json_of(LIMIT)), headers=headers)
    over = client.post(path, content=_chunks(_json_of(LIMIT + 1)), headers=headers)

    assert "content-length" not in within.request.headers
    assert within.status_code == 200
    assert over.status_code == 413
    assert over.json() == TOO_LARGE


def _run_with_understated_length(app: ASGIApp, path: str) -> list[Message]:
    """Send a body longer than its Content-Length claims; return the response."""
    sent: list[Message] = []
    body = _json_of(LIMIT + 1)
    messages: list[Message] = [
        {"type": "http.request", "body": body[:LIMIT], "more_body": True},
        {"type": "http.request", "body": body[LIMIT:], "more_body": False},
    ]

    async def receive() -> Message:
        """Deliver the body in two parts, more than the header declared."""
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        """Collect the response events."""
        sent.append(message)

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-length", b"1"), (b"content-type", b"application/json")],
        "client": ("testclient", 1),
        "server": ("testserver", 80),
    }

    async def run() -> None:
        """Drive the application with the hand-built request."""
        await app(scope, receive, send)

    asyncio.run(run())
    return sent


@pytest.mark.parametrize(("app_factory", "path"), APPS)
def test_understated_content_length_is_still_a_413(
    app_factory: Callable[[], ASGIApp], path: str
) -> None:
    """The byte count is enforced even when the header lies."""
    sent = _run_with_understated_length(app_factory(), path)

    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert [m["status"] for m in starts] == [413]


def test_nothing_from_the_application_follows_a_refusal() -> None:
    """After the 413 the application's own response is dropped."""

    async def stubborn(scope: Scope, receive: Receive, send: Send) -> None:
        """Read the body, then try to answer 200 regardless."""
        await receive()
        await JSONResponse({"ok": True})(scope, receive, send)

    sent = _run_with_understated_length(
        BodyLimitMiddleware(stubborn, max_bytes=LIMIT - 1), "/"
    )

    assert [m["status"] for m in sent if m["type"] == "http.response.start"] == [413]


def test_overflow_after_the_response_started_sends_no_second_response() -> None:
    """If the application already began responding, it is only cut off."""
    sent: list[Message] = []

    async def eager(_scope: Scope, receive: Receive, send: Send) -> None:
        """Start responding before reading the body."""
        await send({"type": "http.response.start", "status": 200, "headers": []})
        assert (await receive())["type"] == "http.disconnect"
        assert (await receive())["type"] == "http.disconnect"

    async def receive() -> Message:
        """Deliver a body that is over the limit."""
        return {"type": "http.request", "body": b"x" * (LIMIT + 1), "more_body": False}

    async def send(message: Message) -> None:
        """Collect the response events."""
        sent.append(message)

    async def run() -> None:
        """Drive the middleware around the eager application."""
        middleware = BodyLimitMiddleware(eager, max_bytes=LIMIT)
        await middleware({"type": "http", "headers": []}, receive, send)

    asyncio.run(run())

    assert [m["type"] for m in sent] == ["http.response.start"]


def test_a_real_application_failure_is_not_hidden() -> None:
    """Only failures caused by our own refusal are swallowed."""

    async def broken(_scope: Scope, _receive: Receive, _send: Send) -> None:
        """Fail for a reason that has nothing to do with the body limit."""
        raise RuntimeError

    async def receive() -> Message:
        """Supply an empty body."""
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(_message: Message) -> None:
        """Discard outgoing events."""

    async def run() -> None:
        """Drive the middleware around the broken application."""
        await BodyLimitMiddleware(broken)(
            {"type": "http", "headers": []}, receive, send
        )

    with pytest.raises(RuntimeError):
        asyncio.run(run())


def test_an_application_that_fails_after_a_refusal_does_not_break_the_response() -> (
    None
):
    """A framework may raise when its client 'disconnects'; the 413 stands."""

    async def fragile(_scope: Scope, receive: Receive, _send: Send) -> None:
        """Treat a disconnect while reading the body as an error."""
        if (await receive())["type"] == "http.disconnect":
            raise ConnectionError

    sent = _run_with_understated_length(
        BodyLimitMiddleware(fragile, max_bytes=LIMIT - 1), "/"
    )

    assert [m["status"] for m in sent if m["type"] == "http.response.start"] == [413]


def test_the_real_app_refuses_an_oversized_request_with_security_headers() -> None:
    """The cap is installed on the application and errors still get headers."""
    response = TestClient(create_app()).post(
        "/v1/sync/operations",
        content=b"x" * (MAX_BODY_BYTES + 1),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json() == TOO_LARGE
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


def test_the_real_app_refuses_an_oversized_streamed_request() -> None:
    """The same holds on a real route when no Content-Length is sent."""
    response = TestClient(create_app()).post(
        "/v1/sync/operations",
        content=_chunks(b"x" * (MAX_BODY_BYTES + 1), size=1024 * 1024),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json() == TOO_LARGE


def test_a_malformed_content_length_is_ignored_and_the_bytes_are_counted() -> None:
    """A non-numeric header cannot be used to skip the check."""
    sent: list[Message] = []
    messages: list[Message] = [
        {"type": "http.request", "body": b"x" * (LIMIT + 1), "more_body": False}
    ]

    async def receive() -> Message:
        """Deliver an oversized body."""
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        """Collect the response events."""
        sent.append(message)

    async def run() -> None:
        """Drive the raw application with a bad Content-Length header."""
        scope: Scope = {"type": "http", "headers": [(b"content-length", b"abc")]}
        await _raw_app()(scope, receive, send)

    asyncio.run(run())

    assert [m["status"] for m in sent if m["type"] == "http.response.start"] == [413]
