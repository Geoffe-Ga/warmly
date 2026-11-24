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

    The template is rebuilt from the request path by putting each path
    parameter's name back in place of its value, which works however deeply
    the router that matched is nested. A request that matched no route is
    reported as ``unmatched``, because its path is arbitrary user input.
    """
    if scope.get("route") is None:
        return UNMATCHED_ROUTE
    names_by_value = {
        str(value): name for name, value in scope.get("path_params", {}).items()
    }
    segments = [
        f"{{{names_by_value[segment]}}}" if segment in names_by_value else segment
        for segment in scope["path"].split("/")
    ]
    return "/".join(segments)


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
