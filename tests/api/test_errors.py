"""Error responses are RFC 9457 problems and never echo request input."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from tests.auth.devices import DEVICE_ID as REGISTERED_DEVICE_ID
from warmly.api.errors import PROBLEM_MEDIA_TYPE, handle_error, http_problem
from warmly.app import create_app
from warmly.schemas.common import MAX_PAYLOAD_CHARS, MAX_SMALL_CIPHERTEXT_CHARS
from warmly.schemas.problem import Problem

CANARY = "CANARY-7f3a-journal-plaintext"
VALID_OPERATION = {
    "op_id": "33333333-3333-4333-8333-333333333333",
    "record_id": "22222222-2222-4222-8222-222222222222",
    "type": 1,
    "base_revision": 0,
    "schema_version": 1,
    "tombstone": False,
    "payload": "b3BhcXVl",
}


def test_invalid_body_is_a_422_problem(client: TestClient) -> None:
    """A malformed request yields a typed problem with a stable code."""
    response = client.post("/v1/sync/operations", json={"operations": []})

    problem = Problem.model_validate(response.json())
    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert problem.code == "request.invalid"
    assert problem.errors[0].location == "body.operations"


def test_validation_errors_never_echo_the_submitted_value(client: TestClient) -> None:
    """Request bodies carry ciphertext; no part of one may come back (SEC-007)."""
    operation = VALID_OPERATION | {"payload": f"not base64! {CANARY}"}

    response = client.post("/v1/sync/operations", json={"operations": [operation]})

    assert response.status_code == 422
    assert CANARY not in response.text


def test_unknown_fields_such_as_owner_id_are_rejected(client: TestClient) -> None:
    """A client cannot supply its own owner; the field is refused (SEC-006)."""
    operation = VALID_OPERATION | {"owner_id": "someone-else"}

    response = client.post("/v1/sync/operations", json={"operations": [operation]})

    assert response.status_code == 422
    assert "body.operations.0.owner_id" in [
        error["location"] for error in response.json()["errors"]
    ]
    assert "someone-else" not in response.text


def test_oversized_batch_is_rejected(client: TestClient) -> None:
    """A batch above the limit is refused rather than truncated."""
    response = client.post(
        "/v1/sync/operations", json={"operations": [VALID_OPERATION] * 101}
    )

    assert response.status_code == 422


@pytest.mark.parametrize("cursor", ["abc", "-1", "1;drop", "9" * 65])
def test_malformed_cursor_is_rejected(client: TestClient, cursor: str) -> None:
    """The cursor is digits only, so nothing else reaches a query."""
    response = client.get("/v1/sync/changes", params={"cursor": cursor})

    assert response.status_code == 422
    assert response.json()["code"] == "request.invalid"


def test_malformed_device_id_is_rejected(client: TestClient) -> None:
    """Path identifiers must be UUIDs."""
    assert client.post("/v1/devices/not-a-uuid/revoke").status_code == 422


def test_unknown_path_is_a_404_problem(client: TestClient) -> None:
    """Framework errors use the same problem format."""
    response = client.get("/v1/nope")

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json() == {
        "type": "about:blank",
        "title": "Not Found",
        "status": 404,
        "code": "request.not_found",
        "errors": [],
    }


def test_wrong_method_is_a_405_problem(client: TestClient) -> None:
    """A wrong method is reported with its own stable code."""
    response = client.delete("/v1/health")

    assert response.status_code == 405
    assert response.json()["code"] == "request.method_not_allowed"


def test_non_standard_status_does_not_break_the_error_handler() -> None:
    """An unknown status code still yields a problem instead of raising."""
    problem = http_problem(799)

    assert (problem.status, problem.code, problem.title) == (799, "http.799", "Error")


def test_other_http_errors_get_a_generic_code() -> None:
    """Statuses without a named code fall back to ``http.<status>``."""
    assert http_problem(418).code == "http.418"


def test_unexpected_exception_is_a_500_problem_without_detail() -> None:
    """A crash never leaks its message, which may contain request data."""
    response = asyncio.run(handle_error(object(), RuntimeError(CANARY)))

    assert response.status_code == 500
    assert response.media_type == PROBLEM_MEDIA_TYPE
    body = bytes(response.body)
    assert CANARY.encode() not in body
    assert json.loads(body) == {
        "type": "about:blank",
        "title": "Internal server error",
        "status": 500,
        "code": "server.internal_error",
        "errors": [],
    }


def test_a_crashing_route_returns_the_500_problem() -> None:
    """The catch-all handler is installed on the application."""
    app = create_app()

    @app.get("/v1/boom")
    def boom() -> None:
        """Fail with a message that must never reach the client."""
        raise RuntimeError(CANARY)

    response = TestClient(app, raise_server_exceptions=False).get("/v1/boom")

    assert response.status_code == 500
    assert response.json()["code"] == "server.internal_error"
    assert CANARY not in response.text


@pytest.mark.parametrize(
    "payload",
    ["has space", "bad*char", "===", "abc=def", "tooMuchPadding===", ""],
    ids=[
        "space",
        "non-alphabet",
        "padding-only",
        "inner-padding",
        "three-pads",
        "empty",
    ],
)
def test_malformed_base64_payload_is_rejected(client: TestClient, payload: str) -> None:
    """Payloads are checked for base64 shape and nothing more (SEC-005)."""
    operation = VALID_OPERATION | {"payload": payload}

    response = client.post("/v1/sync/operations", json={"operations": [operation]})

    assert response.status_code == 422


def test_payload_size_limit_is_inclusive(client: TestClient) -> None:
    """A payload at the limit is accepted; one character more is refused."""
    at_limit = VALID_OPERATION | {"payload": "A" * MAX_PAYLOAD_CHARS}
    over_limit = VALID_OPERATION | {"payload": "A" * (MAX_PAYLOAD_CHARS + 1)}

    accepted = client.post("/v1/sync/operations", json={"operations": [at_limit]})
    refused = client.post("/v1/sync/operations", json={"operations": [over_limit]})

    assert accepted.status_code == 200
    assert refused.status_code == 422
    assert len(refused.text) < 1_000


def test_small_ciphertext_limit_is_inclusive(client: TestClient) -> None:
    """Device names and wrapped keys have their own, smaller limit."""
    path = f"/v1/devices/{REGISTERED_DEVICE_ID}"

    accepted = client.patch(
        path, json={"name_ciphertext": "A" * MAX_SMALL_CIPHERTEXT_CHARS}
    )
    refused = client.patch(
        path, json={"name_ciphertext": "A" * (MAX_SMALL_CIPHERTEXT_CHARS + 1)}
    )

    assert accepted.status_code == 200
    assert refused.status_code == 422


def test_interactive_docs_are_disabled(client: TestClient) -> None:
    """Docs pages load third-party scripts, so they are not served."""
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
