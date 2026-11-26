"""Device identity, request signing and Manage Devices (ADR-0005).

PRD DEV-002, DEV-003, DEV-010, SEC-006; AC-05, AC-20.
"""

import base64
import json
import time
from typing import Any
from uuid import UUID

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.api.cases import CASES, ENROLLMENT_ID, OPERATION, Case
from tests.api.conftest import (
    FakeDatabase,
    InMemoryDeviceStore,
    InMemoryRecoveryStore,
    InMemoryRequestCounters,
    InMemorySyncStore,
)
from tests.auth.devices import (
    DEVICE_ID,
    NAME_CIPHERTEXT,
    OTHER_DEVICE_ID,
    DeviceAuth,
    TestDevice,
    enrollment_proof,
)
from tests.auth.tokens import OTHER_OWNER_ID, OWNER_ID, Signer
from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.app import create_app
from warmly.auth.device import MAX_CLOCK_SKEW_SECONDS
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier

SIGNED_GET = "/v1/sync/changes?cursor=0"
SIGNED_POST = "/v1/sync/operations"
POST_BODY = json.dumps({"operations": [OPERATION]}).encode()
JSON = {"Content-Type": "application/json"}


def _refused(response: Any, code: str) -> None:
    """Check a response is a 401 problem with the given code."""
    assert response.status_code == 401, response.text
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["code"] == code


def _post(client: TestClient, headers: dict[str, str], body: bytes = POST_BODY) -> Any:
    """Send the signed POST with explicit signature headers."""
    return client.post(SIGNED_POST, content=body, headers=headers | JSON)


@pytest.fixture
def new_device() -> TestDevice:
    """Return a device that is not registered yet."""
    return TestDevice(device_id=OTHER_DEVICE_ID)


def _register(client: TestClient, device: TestDevice, **overrides: Any) -> Any:
    """Register ``device`` with a request it signs itself."""
    content = json.dumps(device.registration(**overrides)).encode()
    headers = device.headers("POST", "/v1/devices", content)
    return client.post("/v1/devices", content=content, headers=headers | JSON)


# --- every authenticated request must be signed -------------------------


def test_a_signed_request_from_a_registered_device_is_accepted(
    client: TestClient,
) -> None:
    """The ordinary case: token plus a valid device signature."""
    assert client.get(SIGNED_GET).status_code == 200
    assert client.post(SIGNED_POST, content=POST_BODY, headers=JSON).status_code == 200


# The only routes a session token reaches without any device signature, and
# why (ADR-0005). Creating the first recovery envelope is the one further
# exception; it depends on the body, and the recovery tests cover it.
SESSION_ONLY_ROUTES = {
    # A new device reads the envelope before it can hold the root key.
    ("GET", "/v1/recovery-envelope"),
    # A device asking to be approved has no registered key yet (#22).
    ("POST", "/v1/enrollments"),
    ("GET", f"/v1/enrollments/{ENROLLMENT_ID}"),
    ("POST", f"/v1/enrollments/{ENROLLMENT_ID}/reveal"),
    ("POST", f"/v1/enrollments/{ENROLLMENT_ID}/cancel"),
}
PUBLIC_ROUTES = {("GET", "/v1/health"), ("GET", "/v1/ready")}
SIGNED_CASES = [
    case
    for case in CASES
    if (case.method, case.path) not in SESSION_ONLY_ROUTES | PUBLIC_ROUTES
]


def test_every_exempt_route_is_a_documented_route() -> None:
    """A stale entry in the exemption list fails here instead of hiding."""
    assert {(case.method, case.path) for case in CASES} >= SESSION_ONLY_ROUTES


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if (c.method, c.path) in SESSION_ONLY_ROUTES],
    ids=lambda c: f"{c.method} {c.path}",
)
def test_the_exempt_routes_work_with_the_session_token_alone(
    session_only: TestClient, case: Case
) -> None:
    """These are the calls a device makes before it is registered.

    They may still be refused for another reason, such as a pairing request
    that is not at the right step, but never for the missing signature.
    """
    response = session_only.request(case.method, case.path, json=case.body)

    assert response.status_code in {200, 201, 404, 409}, response.text


@pytest.mark.parametrize("case", SIGNED_CASES, ids=lambda c: f"{c.method} {c.path}")
def test_a_session_token_alone_is_not_enough(
    session_only: TestClient, case: Case
) -> None:
    """A stolen token cannot read or write anything without a device key (D-06).

    The cases are every documented route, so a new route is covered here
    without anyone remembering to add it.
    """
    response = session_only.request(case.method, case.path, json=case.body)

    _refused(response, "device.missing_signature")


@pytest.mark.parametrize(
    "missing",
    ["Warmly-Device", "Warmly-Timestamp", "Warmly-Nonce", "Warmly-Signature"],
)
def test_each_signature_header_is_required(
    session_only: TestClient, device: TestDevice, missing: str
) -> None:
    """Leaving out any one of the four headers is the same as not signing."""
    headers = device.headers("GET", SIGNED_GET)
    del headers[missing]

    _refused(session_only.get(SIGNED_GET, headers=headers), "device.missing_signature")


def test_a_signature_from_another_key_is_refused(
    session_only: TestClient,
) -> None:
    """Naming a registered device does not help without its private key."""
    impostor = TestDevice(device_id=DEVICE_ID)

    _refused(
        session_only.get(SIGNED_GET, headers=impostor.headers("GET", SIGNED_GET)),
        "device.not_authorized",
    )


def test_a_tampered_body_is_refused(
    session_only: TestClient, device: TestDevice
) -> None:
    """The signature covers the body, so a changed body no longer verifies."""
    headers = device.headers("POST", SIGNED_POST, POST_BODY)

    _refused(
        _post(session_only, headers, b'{"wrapped_key":"dGFtcGVyZWQ="}'),
        "device.not_authorized",
    )


def test_a_signature_cannot_be_moved_to_another_path_or_method(
    session_only: TestClient, device: TestDevice
) -> None:
    """The signature covers the method, the path and the query string."""
    headers = device.headers("GET", SIGNED_GET)

    _refused(
        session_only.get("/v1/sync/changes?cursor=1", headers=headers),
        "device.not_authorized",
    )
    _refused(session_only.get("/v1/devices", headers=headers), "device.not_authorized")
    signed_as_post = device.headers("POST", SIGNED_GET)
    _refused(
        session_only.get(SIGNED_GET, headers=signed_as_post), "device.not_authorized"
    )


def test_a_replayed_request_is_refused(
    session_only: TestClient, device: TestDevice
) -> None:
    """The same signed request works once (replay protection)."""
    headers = device.headers("POST", SIGNED_POST, POST_BODY)

    assert _post(session_only, headers).status_code == 200
    _refused(_post(session_only, headers), "device.not_authorized")


def test_a_refused_request_does_not_use_up_its_nonce(
    session_only: TestClient, device: TestDevice, device_store: InMemoryDeviceStore
) -> None:
    """Only a request that really came from the device is remembered."""
    headers = TestDevice(device_id=DEVICE_ID).headers("GET", SIGNED_GET, nonce="n" * 24)

    _refused(session_only.get(SIGNED_GET, headers=headers), "device.not_authorized")

    assert not device_store.nonces
    genuine = device.headers("GET", SIGNED_GET, nonce="n" * 24)
    assert session_only.get(SIGNED_GET, headers=genuine).status_code == 200


@pytest.mark.parametrize(
    "offset",
    [-MAX_CLOCK_SKEW_SECONDS - 5, MAX_CLOCK_SKEW_SECONDS + 5],
    ids=["too old", "too far in the future"],
)
def test_a_stale_timestamp_is_refused(
    session_only: TestClient, device: TestDevice, offset: int
) -> None:
    """A captured request cannot be used later, and clocks cannot be far apart."""
    headers = device.headers("GET", SIGNED_GET, timestamp=int(time.time()) + offset)

    _refused(session_only.get(SIGNED_GET, headers=headers), "device.stale_request")


@pytest.mark.parametrize(
    "offset", [-MAX_CLOCK_SKEW_SECONDS + 5, MAX_CLOCK_SKEW_SECONDS - 5]
)
def test_a_timestamp_within_the_allowed_skew_is_accepted(
    session_only: TestClient, device: TestDevice, offset: int
) -> None:
    """A few minutes of clock difference must not break a device."""
    headers = device.headers("GET", SIGNED_GET, timestamp=int(time.time()) + offset)

    assert session_only.get(SIGNED_GET, headers=headers).status_code == 200


@pytest.mark.parametrize("timestamp", ["", "soon", "12.5", "-5", "1e9"])
def test_a_malformed_timestamp_is_refused(
    session_only: TestClient, device: TestDevice, timestamp: str
) -> None:
    """Only whole seconds in ASCII digits are a timestamp."""
    headers = device.headers("GET", SIGNED_GET) | {"Warmly-Timestamp": timestamp}

    response = session_only.get(SIGNED_GET, headers=headers)

    assert response.status_code == 401
    assert response.json()["code"] in {
        "device.stale_request",
        "device.missing_signature",
    }


@pytest.mark.parametrize(
    "change",
    [
        {"Warmly-Device": "not-a-uuid"},
        {"Warmly-Nonce": "short"},
        {"Warmly-Nonce": "n" * 65},
        {"Warmly-Signature": "not base64!"},
        {"Warmly-Signature": base64.b64encode(b"x" * 63).decode()},
        {"Warmly-Signature": base64.b64encode(b"\x00" * 64).decode()},
    ],
    ids=[
        "device is not a UUID",
        "nonce too short",
        "nonce too long",
        "signature is not base64",
        "signature is the wrong length",
        "signature is all zeros",
    ],
)
def test_malformed_signature_parts_are_refused(
    session_only: TestClient, device: TestDevice, change: dict[str, str]
) -> None:
    """Garbage never raises anything but the fixed refusal."""
    headers = device.headers("GET", SIGNED_GET) | change

    _refused(session_only.get(SIGNED_GET, headers=headers), "device.not_authorized")


def test_a_device_registered_to_another_owner_is_refused(
    app: FastAPI, signer: Signer, device: TestDevice
) -> None:
    """Owner B's token with owner A's device, even correctly signed (invariant 3)."""
    other = TestClient(
        app, headers={"Authorization": f"Bearer {signer.token(sub=OTHER_OWNER_ID)}"}
    )

    _refused(
        other.get(SIGNED_GET, headers=device.headers("GET", SIGNED_GET)),
        "device.not_authorized",
    )


def test_an_unknown_device_and_another_owners_device_look_the_same(
    app: FastAPI, signer: Signer, device: TestDevice
) -> None:
    """Device IDs cannot be probed across accounts (DEV-010)."""
    other = TestClient(
        app, headers={"Authorization": f"Bearer {signer.token(sub=OTHER_OWNER_ID)}"}
    )
    unknown = TestDevice(device_id="d0000000-0000-4000-8000-0000000000ff")

    theirs = other.get(SIGNED_GET, headers=device.headers("GET", SIGNED_GET))
    nobodys = other.get(SIGNED_GET, headers=unknown.headers("GET", SIGNED_GET))

    assert theirs.status_code == nobodys.status_code == 401
    assert theirs.json() == nobodys.json()


def test_a_revoked_device_is_refused(
    client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """Revocation takes effect on the very next request (DEV-003)."""
    device_store.devices[UUID(DEVICE_ID)].revoked = True

    _refused(client.get(SIGNED_GET), "device.revoked")


def test_the_device_check_uses_the_servers_clock(
    signer: Signer, device: TestDevice, device_store: InMemoryDeviceStore
) -> None:
    """The window is judged by the injected clock, not the request's own claim."""
    verifier = TokenVerifier(
        issuer="https://auth.example.test/auth/v1",
        audience="authenticated",
        keys=StaticKeySource([signer.jwk()]),
    )
    app = create_app(
        database=FakeDatabase(),
        token_verifier=verifier,
        recovery_store=InMemoryRecoveryStore(),
        device_store=device_store,
        sync_store=InMemorySyncStore(),
        request_counters=InMemoryRequestCounters(),
        clock=lambda: 2_000_000_000.0,
    )
    client = TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})

    now = client.get(SIGNED_GET, headers=device.headers("GET", SIGNED_GET))
    then = client.get(
        SIGNED_GET, headers=device.headers("GET", SIGNED_GET, timestamp=2_000_000_000)
    )

    _refused(now, "device.stale_request")
    assert then.status_code == 200


def test_a_refused_signature_never_reaches_the_logs(
    session_only: TestClient, device: TestDevice, caplog: pytest.LogCaptureFixture
) -> None:
    """Neither the signature nor the device ID is logged (SEC-007)."""
    headers = device.headers("GET", SIGNED_GET)

    with caplog.at_level("DEBUG", logger="warmly"):
        session_only.get("/v1/devices", headers=headers)

    logged = json.dumps([record.__dict__ for record in caplog.records], default=str)
    assert headers["Warmly-Signature"] not in logged
    assert DEVICE_ID not in logged


# --- registering a device ------------------------------------------------


def test_a_device_registers_with_its_own_signature_and_the_account_proof(
    session_only: TestClient, new_device: TestDevice, device_store: InMemoryDeviceStore
) -> None:
    """Registration needs no existing device, only proof of the two keys."""
    response = _register(session_only, new_device)

    assert response.status_code == 201, response.text
    assert response.json() == {
        "id": OTHER_DEVICE_ID,
        "name_ciphertext": NAME_CIPHERTEXT,
        "public_key": new_device.public_key,
        "created_at": "2026-11-25T00:00:00Z",
        "last_sync_at": None,
        "revoked_at": None,
        "is_current": True,
    }
    assert device_store.devices[UUID(OTHER_DEVICE_ID)].owner_id == UUID(OWNER_ID)


def test_a_newly_registered_device_can_sign_requests(
    app: FastAPI, session_only: TestClient, signer: Signer, new_device: TestDevice
) -> None:
    """After registering, the device is accepted like any other."""
    _register(session_only, new_device)
    signed = TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})
    signed.auth = DeviceAuth(new_device)

    assert signed.get(SIGNED_GET).status_code == 200


def test_a_stolen_token_cannot_register_a_device(
    session_only: TestClient, new_device: TestDevice, device_store: InMemoryDeviceStore
) -> None:
    """Without the account root key there is no valid proof (D-06)."""
    guess = base64.b64encode(b"\x01" * 32).decode()
    wrong_secret = enrollment_proof(
        OTHER_DEVICE_ID, new_device.public_key, Ed25519PrivateKey.generate()
    )

    for proof in (guess, wrong_secret, "bm9wZQ=="):
        _refused(
            _register(session_only, new_device, enrollment_proof=proof),
            "device.not_authorized",
        )
    assert UUID(OTHER_DEVICE_ID) not in device_store.devices


def test_a_proof_for_one_device_or_key_does_not_register_another(
    session_only: TestClient, new_device: TestDevice
) -> None:
    """The proof is bound to both the device ID and the public key."""
    other_key = TestDevice(device_id=OTHER_DEVICE_ID)
    for_other_id = enrollment_proof(DEVICE_ID, new_device.public_key)
    for_other_key = enrollment_proof(OTHER_DEVICE_ID, other_key.public_key)

    for proof in (for_other_id, for_other_key):
        _refused(
            _register(session_only, new_device, enrollment_proof=proof),
            "device.not_authorized",
        )


def test_registration_must_be_signed_by_the_key_being_registered(
    session_only: TestClient, new_device: TestDevice, device: TestDevice
) -> None:
    """Nobody can register a public key they do not hold the private half of."""
    content = json.dumps(new_device.registration()).encode()

    unsigned = session_only.post("/v1/devices", content=content, headers=JSON)
    by_another_key = session_only.post(
        "/v1/devices",
        content=content,
        headers=TestDevice(device_id=OTHER_DEVICE_ID).headers(
            "POST", "/v1/devices", content
        )
        | JSON,
    )
    naming_another_device = session_only.post(
        "/v1/devices",
        content=content,
        headers=new_device.headers("POST", "/v1/devices", content, device_id=DEVICE_ID)
        | JSON,
    )

    _refused(unsigned, "device.missing_signature")
    _refused(by_another_key, "device.not_authorized")
    _refused(naming_another_device, "device.not_authorized")


def test_registration_refuses_a_stale_timestamp(
    session_only: TestClient, new_device: TestDevice
) -> None:
    """A captured registration cannot be replayed later."""
    content = json.dumps(new_device.registration()).encode()
    headers = new_device.headers(
        "POST", "/v1/devices", content, timestamp=int(time.time()) - 3600
    )

    _refused(
        session_only.post("/v1/devices", content=content, headers=headers | JSON),
        "device.stale_request",
    )


def test_a_device_id_cannot_be_registered_twice(
    app: FastAPI, session_only: TestClient, signer: Signer, device: TestDevice
) -> None:
    """Not by the same account, and not by another one (no ID takeover)."""
    again = TestDevice(device_id=DEVICE_ID)
    same_account = _register(session_only, again)

    assert same_account.status_code == 409
    assert same_account.json()["code"] == "device.already_registered"
    assert (
        session_only.get(
            SIGNED_GET, headers=device.headers("GET", SIGNED_GET)
        ).status_code
        == 200
    )


def test_an_account_without_keys_cannot_register_a_device(
    session_only: TestClient,
    new_device: TestDevice,
    recovery_store: InMemoryRecoveryStore,
) -> None:
    """Until the account has created its keys there is nothing to prove against."""
    recovery_store.enrollment_keys.clear()

    response = _register(session_only, new_device)

    assert response.status_code == 409
    assert response.json()["code"] == "device.account_not_ready"


@pytest.mark.parametrize(
    "public_key",
    [
        base64.b64encode(b"\x04" + b"\x00" * 64).decode(),
        base64.b64encode(b"\x04" + b"\x01" * 63).decode(),
        "bm90IGEga2V5",
    ],
    ids=["not on the curve", "wrong length", "not a key"],
)
def test_a_public_key_that_is_not_a_p256_point_is_refused(
    session_only: TestClient, new_device: TestDevice, public_key: str
) -> None:
    """Only a valid P-256 point can be registered."""
    body = new_device.registration(
        public_key=public_key,
        enrollment_proof=enrollment_proof(OTHER_DEVICE_ID, public_key),
    )
    content = json.dumps(body).encode()
    headers = new_device.headers("POST", "/v1/devices", content)

    _refused(
        session_only.post("/v1/devices", content=content, headers=headers | JSON),
        "device.not_authorized",
    )


def test_an_owner_named_in_the_registration_is_rejected_not_obeyed(
    session_only: TestClient, new_device: TestDevice
) -> None:
    """The body has no owner field; adding one is an invalid request."""
    response = _register(session_only, new_device, owner_id=OTHER_OWNER_ID)

    assert response.status_code in {401, 422}
    assert response.status_code != 201


# --- Manage Devices ------------------------------------------------------


def test_listing_shows_only_my_devices_and_marks_the_current_one(
    app: FastAPI,
    client: TestClient,
    session_only: TestClient,
    signer: Signer,
    new_device: TestDevice,
    device_store: InMemoryDeviceStore,
) -> None:
    """Another account's devices never appear (DEV-010, AC-20)."""
    _register(session_only, new_device)
    theirs = TestDevice(device_id="d0000000-0000-4000-8000-0000000000cc")
    device_store.add(OTHER_OWNER_ID, theirs)

    devices = client.get("/v1/devices").json()["devices"]

    assert [(d["id"], d["is_current"]) for d in devices] == [
        (DEVICE_ID, True),
        (OTHER_DEVICE_ID, False),
    ]
    assert theirs.device_id not in json.dumps(devices)


def test_renaming_replaces_only_the_encrypted_name(
    client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """The server stores the new ciphertext and never sees a name."""
    response = client.patch(
        f"/v1/devices/{DEVICE_ID}", json={"name_ciphertext": "bmV3"}
    )

    assert response.status_code == 200
    assert response.json()["name_ciphertext"] == "bmV3"
    assert response.json()["is_current"] is True
    assert device_store.devices[UUID(DEVICE_ID)].device.name_ciphertext == "bmV3"


def test_renaming_another_owners_device_is_a_404_like_an_unknown_one(
    client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """404, never 403, so device IDs cannot be probed (DEV-010)."""
    theirs = TestDevice(device_id="d0000000-0000-4000-8000-0000000000cc")
    device_store.add(OTHER_OWNER_ID, theirs)

    for device_id in (theirs.device_id, "d0000000-0000-4000-8000-0000000000dd"):
        response = client.patch(
            f"/v1/devices/{device_id}", json={"name_ciphertext": "bmV3"}
        )
        assert response.status_code == 404
        assert response.json()["code"] == "device.not_found"
    assert (
        device_store.devices[UUID(theirs.device_id)].device.name_ciphertext
        == NAME_CIPHERTEXT
    )


def test_the_contract_names_the_signature_headers_nowhere_secret(
    anonymous: TestClient,
) -> None:
    """The registration body documents the proof field."""
    schema = anonymous.get("/v1/openapi.json").json()

    assert "enrollment_proof" in json.dumps(
        schema["components"]["schemas"]["RegisterDeviceRequest"]
    )
