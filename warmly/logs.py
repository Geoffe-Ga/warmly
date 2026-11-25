"""Structured, privacy-safe logging for the Warmly API.

The service handles ciphertext and credentials, so the rule is strict: a log
line may contain only the fields in ``REQUEST_LOG_FIELDS``. It never contains
a request or response body, a header, a query string, a concrete URL path
(paths carry record and device identifiers), a client address, or an account
identifier (PRD §8, SEC-007).
"""

import json
import logging
from typing import Any

LOGGER_NAME = "warmly"
REQUEST_EVENT = "http.request"

# The complete set of fields a request log line may carry. Adding a field
# means updating the canary tests in tests/api/test_request_log.py first.
REQUEST_LOG_FIELDS = frozenset(
    {"event", "event_id", "method", "route", "status", "duration_ms"}
)


# Loggers whose messages are free text that can include connection details
# such as a database host name. They are detached from every handler; the
# readiness check reports database trouble without that detail.
_THIRD_PARTY_LOGGERS_TO_SILENCE = ("psycopg.pool",)


class JsonFormatter(logging.Formatter):
    """Format a record as one JSON object per line.

    Only the level, the logger name, the message and the explicitly attached
    ``fields`` mapping are written. Exception text is deliberately left out:
    it can quote request data.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Render the record as a JSON line.

        Args:
            record: The log record to render.

        Returns:
            A single-line JSON string.
        """
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            payload.update(fields)
        return json.dumps(payload, sort_keys=True)


def get_logger() -> logging.Logger:
    """Return the application logger.

    Returns:
        The ``warmly`` logger.
    """
    return logging.getLogger(LOGGER_NAME)


def configure_logging(level: int = logging.INFO) -> None:
    """Send application logs to stderr as JSON lines.

    Safe to call more than once: an existing JSON handler is reused.

    Args:
        level: Minimum level to emit.
    """
    for name in _THIRD_PARTY_LOGGERS_TO_SILENCE:
        third_party = logging.getLogger(name)
        third_party.propagate = False
        if not third_party.handlers:
            third_party.addHandler(logging.NullHandler())
    logger = get_logger()
    logger.setLevel(level)
    if not any(isinstance(h.formatter, JsonFormatter) for h in logger.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)


def log_failure(event: str) -> None:
    """Record that something went wrong, by a fixed name and nothing else.

    Args:
        event: A fixed name from the code, such as ``sync.last_sync_failed``.
            Never text from a request or an exception.
    """
    get_logger().warning(event, extra={"fields": {"event": event}})


def log_request(
    *, event_id: str, method: str, route: str, status: int, duration_ms: float
) -> None:
    """Record one handled request using only the allowed fields.

    Args:
        event_id: Opaque identifier also returned to the client.
        method: HTTP method.
        route: Route template such as ``/v1/devices/{device_id}``, never the
            concrete path.
        status: Response status code.
        duration_ms: Time taken to handle the request.
    """
    get_logger().info(
        REQUEST_EVENT,
        extra={
            "fields": {
                "event": REQUEST_EVENT,
                "event_id": event_id,
                "method": method,
                "route": route,
                "status": status,
                "duration_ms": round(duration_ms, 1),
            }
        },
    )
