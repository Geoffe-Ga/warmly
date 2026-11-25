"""Every /v1 route with a valid request, shared by the API test modules.

Adding a route without adding a case here fails
``test_smoke_cases_cover_every_documented_operation``.
"""

import base64
import hashlib
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

# 32 synthetic bytes in base64, standing in for digests and random values.
BYTES32 = base64.b64encode(bytes(range(32))).decode()


def commitment(device_id: str, public_key: str, nonce: str) -> str:
    """Compute a pairing commitment as the app does, independently of the API."""
    name = device_id.encode()
    digest = hashlib.sha256(
        b"warmly-pairing-commit-v1"
        + len(name).to_bytes(2, "big")
        + name
        + base64.b64decode(public_key)
        + base64.b64decode(nonce)
    ).digest()
    return base64.b64encode(digest).decode()


# The first two steps of a pairing, as (path, body).
CLAIM = (f"/v1/enrollments/{ENROLLMENT_ID}/claim", {"approver_nonce": BYTES32})
REVEAL = (f"/v1/enrollments/{ENROLLMENT_ID}/reveal", {"joiner_nonce": BYTES32})

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
    # Earlier steps of a pairing, sent first so this one finds the request
    # at the step it needs: (path, body) pairs, each a POST.
    before: tuple[tuple[str, dict[str, Any]], ...] = ()

    def send(self, client: TestClient) -> Response:
        """Send this case's request with ``client``, after any earlier steps."""
        for path, body in self.before:
            client.post(path, json=body)
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
        body={
            "device_id": DEVICE_ID,
            "public_key": CIPHERTEXT,
            "commitment": commitment(DEVICE_ID, CIPHERTEXT, BYTES32),
        },
        stub=False,
    ),
    Case("GET", "/v1/enrollments/open", Enrollment, stub=False),
    Case("GET", f"/v1/enrollments/{ENROLLMENT_ID}", Enrollment, stub=False),
    Case("POST", CLAIM[0], Enrollment, body=CLAIM[1], stub=False),
    Case("POST", REVEAL[0], Enrollment, body=REVEAL[1], stub=False, before=(CLAIM,)),
    Case(
        "POST",
        f"/v1/enrollments/{ENROLLMENT_ID}/approve",
        Enrollment,
        body={"wrapped_key": CIPHERTEXT},
        stub=False,
        before=(CLAIM, REVEAL),
    ),
    Case(
        "POST",
        f"/v1/enrollments/{ENROLLMENT_ID}/reject",
        Enrollment,
        stub=False,
        before=(CLAIM,),
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
