"""Request logs carry only allowed fields and never request content (SEC-007)."""

import json
import logging
import sys

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from tests.api.cases import CASES, DEVICE_ID, ENROLLMENT_ID, Case
from warmly.app import create_app
from warmly.logs import (
    LOGGER_NAME,
    REQUEST_LOG_FIELDS,
    JsonFormatter,
    configure_logging,
    get_logger,
)
from warmly.middleware.request_log import EVENT_ID_HEADER, UNMATCHED_ROUTE

CANARY = "CANARY7f3aJournalPlaintext"
# The test client logs the URLs it requests. That is the client's own logger,
# not the service, so it is excluded from the "what did the server log" checks.
CLIENT_LOGGER = "httpx"


def _with_canary(value: object) -> object:
    """Replace every string in a JSON-like value with the canary."""
    if isinstance(value, dict):
        return {key: _with_canary(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_with_canary(item) for item in value]
    return CANARY if isinstance(value, str) else value


def _fields(caplog: pytest.LogCaptureFixture) -> list[dict[str, object]]:
    """Return the structured fields of every captured request log line."""
    return [record.fields for record in caplog.records if hasattr(record, "fields")]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.method} {c.path}")
def test_request_content_never_reaches_the_logs(
    client: TestClient, caplog: pytest.LogCaptureFixture, case: Case
) -> None:
    """A canary in the body, query and headers appears in no log line (AC-04)."""
    caplog.set_level(logging.DEBUG)
    formatter = JsonFormatter()

    client.request(
        case.method,
        case.path,
        json=_with_canary(case.body),
        params={"note": CANARY},
        headers={"Authorization": f"Bearer {CANARY}", "X-Extra": CANARY},
    )

    server_records = [r for r in caplog.records if not r.name.startswith(CLIENT_LOGGER)]
    assert server_records
    assert all(CANARY not in formatter.format(record) for record in server_records)
    assert all(CANARY not in record.getMessage() for record in server_records)


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.method} {c.path}")
def test_each_request_logs_one_line_with_only_the_allowed_fields(
    client: TestClient, caplog: pytest.LogCaptureFixture, case: Case
) -> None:
    """The log schema is closed: nothing beyond REQUEST_LOG_FIELDS."""
    caplog.set_level(logging.INFO, logger=LOGGER_NAME)

    response = client.request(case.method, case.path, json=case.body)

    (fields,) = _fields(caplog)
    assert set(fields) == REQUEST_LOG_FIELDS
    assert fields["method"] == case.method
    assert fields["status"] == response.status_code
    assert fields["event_id"] == response.headers[EVENT_ID_HEADER]


def test_route_is_logged_as_a_template_not_a_concrete_path(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """Paths carry device and record IDs, so only the template is logged."""
    caplog.set_level(logging.INFO, logger=LOGGER_NAME)

    client.post(f"/v1/devices/{DEVICE_ID}/revoke")
    client.get(f"/v1/enrollments/{ENROLLMENT_ID}")

    routes = [fields["route"] for fields in _fields(caplog)]
    assert routes == [
        "/v1/devices/{device_id}/revoke",
        "/v1/enrollments/{enrollment_id}",
    ]
    logged = json.dumps(_fields(caplog))
    assert DEVICE_ID not in logged
    assert ENROLLMENT_ID not in logged


def test_route_template_survives_values_that_collide_with_segments(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A parameter equal to a literal segment, or to another parameter, is fine."""
    app = create_app()
    router = APIRouter(prefix="/v1/pairs")

    @router.get("/{first}/v1/{second}")
    def pair(first: str, second: str) -> dict[str, str]:
        """Echo the two path parameters."""
        return {"first": first, "second": second}

    app.include_router(router)
    caplog.set_level(logging.INFO, logger=LOGGER_NAME)

    TestClient(app).get("/v1/pairs/v1/v1/v1")
    TestClient(app).get("/v1/pairs/pairs/v1/pairs")

    assert [fields["route"] for fields in _fields(caplog)] == [
        "/v1/pairs/{first}/v1/{second}",
        "/v1/pairs/{first}/v1/{second}",
    ]


def test_unmatched_path_is_logged_without_the_path(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """A 404 path may be anything a user typed; it is never recorded."""
    caplog.set_level(logging.INFO, logger=LOGGER_NAME)

    client.get(f"/v1/{CANARY}")

    (fields,) = _fields(caplog)
    assert fields["route"] == UNMATCHED_ROUTE
    assert fields["status"] == 404
    assert CANARY not in json.dumps(fields)


def test_event_ids_are_opaque_and_unique(client: TestClient) -> None:
    """Each response carries its own 32-hex-character event ID."""
    first = client.get("/v1/health").headers[EVENT_ID_HEADER]
    second = client.get("/v1/health").headers[EVENT_ID_HEADER]

    assert first != second
    assert len(first) == 32
    assert int(first, 16) >= 0


def test_a_crashing_route_is_logged_as_500_without_exception_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Exception messages can quote request data, so they are not logged."""
    app = create_app()

    @app.get("/v1/boom")
    def boom() -> None:
        """Fail with a message that must never reach the logs."""
        raise RuntimeError(CANARY)

    caplog.set_level(logging.INFO, logger=LOGGER_NAME)
    TestClient(app, raise_server_exceptions=False).get("/v1/boom")

    (fields,) = _fields(caplog)
    assert fields["status"] == 500
    formatter = JsonFormatter()
    assert all(CANARY not in formatter.format(record) for record in caplog.records)


def test_json_formatter_writes_one_sorted_json_object() -> None:
    """Log lines are machine-readable JSON with level, logger and message."""
    record = logging.LogRecord(
        LOGGER_NAME, logging.INFO, __file__, 1, "hello", (), None
    )
    record.fields = {"event": "x", "status": 200}

    assert json.loads(JsonFormatter().format(record)) == {
        "event": "x",
        "level": "INFO",
        "logger": LOGGER_NAME,
        "message": "hello",
        "status": 200,
    }


def _fail_with_canary() -> None:
    """Raise an error whose message is the canary."""
    raise ValueError(CANARY)


def test_json_formatter_drops_exception_text_and_ignores_bad_fields() -> None:
    """Tracebacks and non-mapping extras never reach the output."""
    try:
        _fail_with_canary()
    except ValueError:
        record = logging.LogRecord(
            LOGGER_NAME, logging.ERROR, __file__, 1, "failed", (), sys.exc_info()
        )
    record.fields = "not a mapping"

    rendered = JsonFormatter().format(record)

    assert CANARY not in rendered
    assert json.loads(rendered) == {
        "level": "ERROR",
        "logger": LOGGER_NAME,
        "message": "failed",
    }


def test_configure_logging_installs_one_json_handler() -> None:
    """Calling it twice does not duplicate output."""
    logger = get_logger()
    original = logger.handlers.copy()
    try:
        configure_logging()
        configure_logging(logging.WARNING)

        added = [h for h in logger.handlers if h not in original]
        assert len(added) == 1
        assert isinstance(added[0].formatter, JsonFormatter)
        assert logger.level == logging.WARNING
    finally:
        for handler in logger.handlers.copy():
            if handler not in original:
                logger.removeHandler(handler)
        logger.setLevel(logging.NOTSET)
