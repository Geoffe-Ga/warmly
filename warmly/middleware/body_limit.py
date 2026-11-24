"""Reject oversized request bodies before they are parsed.

Without a cap, one batch of sync operations could reach well over 100 MB of
JSON, all of it parsed and validated in memory. The limit is enforced twice:
from the ``Content-Length`` header when present, and by counting the bytes
actually received, because the header can be missing or wrong. In the second
case the middleware answers 413 itself and tells the application the client
went away, so the result does not depend on how a framework handles errors
raised while it reads a body.
"""

from http import HTTPStatus

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from warmly.api.errors import problem_response
from warmly.schemas.problem import Problem

# Enough for several maximum-size records in one batch. Clients split larger
# batches; the server never truncates.
MAX_BODY_BYTES = 8 * 1024 * 1024


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
        rejected = False

        async def reject() -> None:
            """Answer 413 once, unless the application already responded."""
            nonlocal rejected, response_started
            rejected = True
            if not response_started:
                response_started = True
                await problem_response(too_large_problem())(scope, receive, send)

        async def counting_receive() -> Message:
            """Count body bytes; past the cap, reject and report a disconnect.

            The refusal is sent from here rather than raised, because a web
            framework may catch an exception raised while it reads the body
            and turn it into a different error.
            """
            nonlocal received
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    await reject()
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            """Forward the application's response unless we already refused."""
            nonlocal response_started
            if rejected:
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            # The application may fail when its client "disconnects". That is
            # our doing and already answered; any other failure is real.
            if not rejected:
                raise
