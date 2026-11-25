"""Every /v1 route with a valid request, shared by the API test modules.

Adding a route without adding a case here fails
``test_smoke_cases_cover_every_documented_operation``.
"""

import json
from dataclasses import dataclass, field
from typing import Any

from fastapi.testclient import TestClient
from httpx2 import Response
from pydantic import BaseModel

from tests.auth.devices import DEVICE_ID as REGISTERED_DEVICE_ID
from tests.auth.devices import TestDevice
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

# A device that is not registered yet, for the registration case.
NEW_DEVICE = TestDevice(device_id=DEVICE_ID)

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
    # A device that signs this request itself, for the one route a device
    # calls before it is registered. Otherwise the client's device signs.
    signed_by: TestDevice | None = None

    def send(self, client: TestClient) -> Response:
        """Send this case's request with ``client``."""
        if self.signed_by is None:
            return client.request(self.method, self.path, json=self.body)
        content = json.dumps(self.body).encode()
        headers = self.signed_by.headers(self.method, self.path, content)
        return client.request(
            self.method,
            self.path,
            content=content,
            headers=headers | {"Content-Type": "application/json"},
        )


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
    Case("GET", "/v1/devices", DeviceList, stub=False),
    Case(
        "POST",
        "/v1/devices",
        Device,
        status=201,
        body=NEW_DEVICE.registration(),
        stub=False,
        signed_by=NEW_DEVICE,
    ),
    Case(
        "PATCH",
        f"/v1/devices/{REGISTERED_DEVICE_ID}",
        Device,
        body={"name_ciphertext": CIPHERTEXT},
        stub=False,
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
    Case("GET", "/v1/recovery-envelope", RecoveryEnvelope, stub=False),
    Case(
        "PUT",
        "/v1/recovery-envelope",
        RecoveryEnvelope,
        body={"expected_version": 1, "format_version": 1, "wrapped_key": CIPHERTEXT},
        stub=False,
    ),
]
