"""Smoke tests: every /v1 route answers with a schema-valid body (SYNC-002).

The skeleton routes are stubs. Each test checks the status code, validates the
body against the response model, and checks the stub marker header.
"""

import pytest
from fastapi.testclient import TestClient

from tests.api.cases import (
    CASES,
    DEVICE_ID,
    ENROLLMENT_ID,
    OP_ID,
    OPERATION,
    Case,
)
from tests.auth.devices import DEVICE_ID as REGISTERED_DEVICE_ID
from warmly import __version__
from warmly.api.stub import STUB_HEADER


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.method} {c.path}")
def test_route_returns_a_schema_valid_body(client: TestClient, case: Case) -> None:
    """Each route returns its documented status and a valid response model."""
    response = case.send(client)

    assert response.status_code == case.status
    case.model.model_validate(response.json())


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.method} {c.path}")
def test_stub_routes_are_marked_and_real_routes_are_not(
    client: TestClient, case: Case
) -> None:
    """A stub must say it is a stub; a real route must not claim to be one."""
    response = case.send(client)

    assert (response.headers.get(STUB_HEADER) == "true") is case.stub


def test_smoke_cases_cover_every_documented_operation(client: TestClient) -> None:
    """Adding a route without a smoke case fails this test."""
    schema = client.get("/v1/openapi.json").json()
    documented = {
        (method.upper(), path)
        for path, item in schema["paths"].items()
        for method in item
    }
    covered = {(case.method, _template(case.path)) for case in CASES}

    assert covered == documented


def _template(path: str) -> str:
    """Map a concrete test path back to its OpenAPI path template."""
    return (
        path.split("?")[0]
        .replace(DEVICE_ID, "{device_id}")
        .replace(REGISTERED_DEVICE_ID, "{device_id}")
        .replace(ENROLLMENT_ID, "{enrollment_id}")
    )


def test_health_reports_the_package_version(client: TestClient) -> None:
    """Health carries the running version."""
    assert client.get("/v1/health").json() == {"status": "ok", "version": __version__}


def test_changes_echo_the_cursor_and_default_to_zero(client: TestClient) -> None:
    """The stub feed is empty and hands the cursor straight back."""
    assert client.get("/v1/sync/changes?cursor=41").json() == {
        "changes": [],
        "next_cursor": "41",
        "has_more": False,
    }
    assert client.get("/v1/sync/changes").json()["next_cursor"] == "0"


def test_stub_operations_never_claim_to_have_applied(client: TestClient) -> None:
    """A stub persists nothing, so it must not report ``applied``."""
    second = OPERATION | {"op_id": "55555555-5555-4555-8555-555555555555"}

    response = client.post(
        "/v1/sync/operations", json={"operations": [OPERATION, second]}
    )

    assert response.json() == {
        "results": [
            {
                "op_id": OP_ID,
                "status": "rejected",
                "revision": None,
                "current_revision": None,
            },
            {
                "op_id": second["op_id"],
                "status": "rejected",
                "revision": None,
                "current_revision": None,
            },
        ]
    }


def test_revoke_returns_a_revoked_device(client: TestClient) -> None:
    """The revoke stub returns the device with a revocation time."""
    body = client.post(f"/v1/devices/{DEVICE_ID}/revoke").json()

    assert body["id"] == DEVICE_ID
    assert body["revoked_at"] is not None
