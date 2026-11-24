"""Log one privacy-safe line per request and hand the client an event ID.

The ``Warmly-Event-Id`` response header lets a user report a problem with an
opaque identifier that can be matched to a log line, without either side
revealing anything about the request's content.
"""

import time
from uuid import uuid4

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from warmly.logs import log_request

EVENT_ID_HEADER = "Warmly-Event-Id"
UNMATCHED_ROUTE = "unmatched"


def _route_template(scope: Scope) -> str:
    """Return the matched route's template, never the concrete path.

    The matched route knows its own template, but a route inside a nested
    router only knows the part after the router's prefix. The prefix is
    therefore taken from the front of the real path: it is whatever precedes
    the route's own segments, and router prefixes in this application are
    static. Parameter values never enter the result, so two equal values, or
    a value that happens to equal a literal segment, cannot confuse it.

    A request that matched no route is reported as ``unmatched``, because its
    path is arbitrary user input.
    """
    own_template = getattr(scope.get("route"), "path", None)
    if not isinstance(own_template, str):
        return UNMATCHED_ROUTE
    own_segments = own_template.strip("/").split("/") if own_template.strip("/") else []
    path_segments = scope["path"].strip("/").split("/")
    prefix = path_segments[: len(path_segments) - len(own_segments)]
    return "/" + "/".join([*prefix, *own_segments])


class RequestLogMiddleware:
    """Record method, route template, status and duration for each request."""

    def __init__(self, app: ASGIApp) -> None:
        """Wrap an ASGI application.

        Args:
            app: The application to wrap.
        """
        self.app = app

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

        event_id = uuid4().hex
        started = time.perf_counter()
        status = 500

        async def send_with_event_id(message: Message) -> None:
            """Capture the status and add the event ID header."""
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)[EVENT_ID_HEADER] = event_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_event_id)
        finally:
            log_request(
                event_id=event_id,
                method=scope["method"],
                route=_route_template(scope),
                status=status,
                duration_ms=(time.perf_counter() - started) * 1000,
            )
