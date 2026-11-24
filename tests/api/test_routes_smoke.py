"""Smoke tests: every /v1 route answers with a schema-valid body (SYNC-002).

The skeleton routes are stubs. Each test checks the status code, validates the
body against the response model, and checks the stub marker header.
"""

from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from warmly import __version__
from warmly.api.stub import STUB_HEADER
from warmly.schemas.devices import Device, DeviceList
from warmly.schemas.enrollment import Enrollment
from warmly.schemas.health import Health, Readiness
from warmly.schemas.recovery import RecoveryEnvelope
from warmly.schemas.sync import ChangesResponse, OperationsResponse

DEVICE_ID = "11111111-1111-4111-8111-111111111111"
RECORD_ID = "22222222-2222-4222-8222-222222222222"
OP_ID = "33333333-3333-4333-8333-333333333333"
ENROLLMENT_ID = "44444444-4444-4444-8444-444444444444"
CIPHERTEXT = "b3BhcXVl"

OPERATION = {
    "op_id": OP_ID,
    "record_id": RECORD_ID,
    "type": 1,
    "base_revision": 0,
    "schema_version": 1,
    "tombstone": False,
    "payload": CIPHERTEXT,
}


@dataclass(frozen=True)
class Case:
    """One route under test."""

    method: str
    path: str
    model: type[BaseModel]
    status: int = 200
    body: dict[str, Any] | None = None
    stub: bool = True
    id: str = field(default="")


CASES = [
    Case("GET", "/v1/health", Health, stub=False),
    Case("GET", "/v1/ready", Readiness, stub=False),
    Case("GET", "/v1/sync/changes?cursor=0", ChangesResponse),
    Case(
        "POST",
        "/v1/sync/operations",
        OperationsResponse,
        body={"operations": [OPERATION]},
    ),
    Case("GET", "/v1/devices", DeviceList),
    Case(
        "POST",
        "/v1/devices",
        Device,
        status=201,
        body={
            "device_id": DEVICE_ID,
            "public_key": CIPHERTEXT,
            "name_ciphertext": CIPHERTEXT,
        },
    ),
    Case(
        "PATCH",
        f"/v1/devices/{DEVICE_ID}",
        Device,
        body={"name_ciphertext": CIPHERTEXT},
    ),
    Case("POST", f"/v1/devices/{DEVICE_ID}/revoke", Device),
    Case(
        "POST",
        "/v1/enrollments",
        Enrollment,
        status=201,
        body={"device_id": DEVICE_ID, "public_key": CIPHERTEXT},
    ),
    Case("GET", f"/v1/enrollments/{ENROLLMENT_ID}", Enrollment),
    Case(
        "POST",
        f"/v1/enrollments/{ENROLLMENT_ID}/approve",
        Enrollment,
        body={"wrapped_key": CIPHERTEXT},
    ),
    Case("GET", "/v1/recovery-envelope", RecoveryEnvelope),
    Case(
        "PUT",
        "/v1/recovery-envelope",
        RecoveryEnvelope,
        body={"expected_version": 0, "format_version": 1, "wrapped_key": CIPHERTEXT},
    ),
]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.method} {c.path}")
def test_route_returns_a_schema_valid_body(client: TestClient, case: Case) -> None:
    """Each route returns its documented status and a valid response model."""
    response = client.request(case.method, case.path, json=case.body)

    assert response.status_code == case.status
    case.model.model_validate(response.json())


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.method} {c.path}")
def test_stub_routes_are_marked_and_real_routes_are_not(
    client: TestClient, case: Case
) -> None:
    """A stub must say it is a stub; a real route must not claim to be one."""
    response = client.request(case.method, case.path, json=case.body)

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


def test_register_device_echoes_the_submitted_identity(client: TestClient) -> None:
    """The registration stub reflects the caller's device as current."""
    body = client.post(
        "/v1/devices",
        json={
            "device_id": DEVICE_ID,
            "public_key": CIPHERTEXT,
            "name_ciphertext": CIPHERTEXT,
        },
    ).json()

    assert body["id"] == DEVICE_ID
    assert body["is_current"] is True
    assert body["revoked_at"] is None


def test_revoke_returns_a_revoked_device(client: TestClient) -> None:
    """The revoke stub returns the device with a revocation time."""
    body = client.post(f"/v1/devices/{DEVICE_ID}/revoke").json()

    assert body["id"] == DEVICE_ID
    assert body["revoked_at"] is not None


def test_approve_relays_the_wrapped_key_unchanged(client: TestClient) -> None:
    """The server relays the wrapped key byte for byte (DEV-001)."""
    body = client.post(
        f"/v1/enrollments/{ENROLLMENT_ID}/approve", json={"wrapped_key": CIPHERTEXT}
    ).json()

    assert body["status"] == "approved"
    assert body["wrapped_key"] == CIPHERTEXT


def test_put_recovery_envelope_advances_the_version(client: TestClient) -> None:
    """Rotation yields the next version (compare-and-swap shape, SEC-003)."""
    body = client.put(
        "/v1/recovery-envelope",
        json={"expected_version": 4, "format_version": 1, "wrapped_key": CIPHERTEXT},
    ).json()

    assert body == {"version": 5, "format_version": 1, "wrapped_key": CIPHERTEXT}
