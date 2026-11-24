"""Reject oversized request bodies before they are parsed.

Without a cap, one batch of sync operations could reach well over 100 MB of
JSON, all of it parsed and validated in memory. The limit is enforced twice:
from the ``Content-Length`` header when present, and by counting the bytes
actually received, because the header can be missing or wrong.
"""

from http import HTTPStatus

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from warmly.api.errors import problem_response
from warmly.schemas.problem import Problem

# Enough for several maximum-size records in one batch. Clients split larger
# batches; the server never truncates.
MAX_BODY_BYTES = 8 * 1024 * 1024


class BodyTooLargeError(Exception):
    """Raised inside the receive channel when the byte count passes the cap."""


def too_large_problem() -> Problem:
    """Describe a request whose body exceeds the limit.

    Returns:
        A 413 problem with a stable code.
    """
    return Problem(
        title="Request body too large",
        status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        code="request.too_large",
    )


def _declared_length(scope: Scope) -> int | None:
    """Read a valid ``Content-Length`` from the request, if there is one."""
    for name, value in scope["headers"]:
        if name == b"content-length" and value.isdigit():
            return int(value)
    return None


class BodyLimitMiddleware:
    """Refuse HTTP requests whose body is larger than ``max_bytes``."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        """Wrap an ASGI application.

        Args:
            app: The application to wrap.
            max_bytes: Largest accepted request body, in bytes.
        """
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI event stream.

        Args:
            scope: Connection scope.
            receive: Receive channel.
            send: Send channel.
        """
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _declared_length(scope)
        if declared is not None and declared > self.max_bytes:
            await problem_response(too_large_problem())(scope, receive, send)
            return

        received = 0
        response_started = False

        async def counting_receive() -> Message:
            """Pass request events through while counting body bytes."""
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLargeError
            return message

        async def tracking_send(message: Message) -> None:
            """Remember whether the application has begun its response."""
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except BodyTooLargeError:
            if response_started:
                raise
            await problem_response(too_large_problem())(scope, receive, send)
