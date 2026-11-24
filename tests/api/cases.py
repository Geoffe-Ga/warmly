"""Every /v1 route with a valid request, shared by the API test modules.

Adding a route without adding a case here fails
``test_smoke_cases_cover_every_documented_operation``.
"""

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

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
