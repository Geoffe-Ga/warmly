"""Device pairing routes (PRD DEV-001 path A, AC-19; ADR-0005).

The server relays the pairing and can read no secret in it. These tests check
what it must still enforce: each step happens once and in order, a request
expires, only an account's own registered devices can approve, and one
account can never touch another's request.
"""

import base64
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.api.cases import BYTES32, CIPHERTEXT, DEVICE_ID, commitment
from tests.api.conftest import (
    SEEDED_ENROLLMENT_ID,
    InMemoryDeviceStore,
    InMemoryEnrollmentStore,
)
from tests.auth.devices import OTHER_DEVICE_ID, DeviceAuth, TestDevice
from tests.auth.tokens import OTHER_OWNER_ID, OWNER_ID, Signer
from warmly.api.enrollment import commitment_matches
from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.schemas.enrollment import Enrollment

ID = str(SEEDED_ENROLLMENT_ID)
OTHER_NONCE = base64.b64encode(bytes(range(32, 64))).decode()
START = {
    "device_id": DEVICE_ID,
    "public_key": CIPHERTEXT,
    "commitment": commitment(DEVICE_ID, CIPHERTEXT, BYTES32),
}
FIXTURE: dict[str, str] = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "pairing" / "v1.json").read_text()
)


def _problem(response: Any, status: int, code: str) -> None:
    """Check a response is a problem with the given status and code."""
    assert response.status_code == status, response.text
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["code"] == code


def _claim(client: TestClient, enrollment_id: str = ID) -> Any:
    return client.post(
        f"/v1/enrollments/{enrollment_id}/claim", json={"approver_nonce": BYTES32}
    )


def _reveal(client: TestClient, enrollment_id: str = ID) -> Any:
    return client.post(
        f"/v1/enrollments/{enrollment_id}/reveal", json={"joiner_nonce": BYTES32}
    )


def _approve(client: TestClient, enrollment_id: str = ID) -> Any:
    return client.post(
        f"/v1/enrollments/{enrollment_id}/approve", json={"wrapped_key": CIPHERTEXT}
    )


@pytest.fixture
def second_device(device_store: InMemoryDeviceStore) -> TestDevice:
    """Return another registered device of the same account."""
    second = TestDevice(device_id=OTHER_DEVICE_ID)
    device_store.add(OWNER_ID, second)
    return second


@pytest.fixture
def second_client(
    app: FastAPI, signer: Signer, second_device: TestDevice
) -> TestClient:
    """Return a client signed in as the test owner on their second device."""
    client = TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})
    client.auth = DeviceAuth(second_device)
    return client


@pytest.fixture
def other_owner(
    app: FastAPI, signer: Signer, device_store: InMemoryDeviceStore
) -> TestClient:
    """Return another account, signed in on a registered device of its own."""
    theirs = TestDevice(device_id="d0000000-0000-4000-8000-0000000000ee")
    device_store.add(OTHER_OWNER_ID, theirs)
    client = TestClient(
        app, headers={"Authorization": f"Bearer {signer.token(sub=OTHER_OWNER_ID)}"}
    )
    client.auth = DeviceAuth(theirs)
    return client


# --- the whole pairing ----------------------------------------------------


def test_a_pairing_runs_start_claim_reveal_approve(
    client: TestClient, session_only: TestClient
) -> None:
    """The new device needs only the session; the approver signs (AC-19)."""
    started = session_only.post("/v1/enrollments", json=START)
    assert started.status_code == 201
    enrollment = started.json()
    assert enrollment["status"] == "pending"
    assert enrollment["device_id"] == DEVICE_ID
    assert enrollment["public_key"] == CIPHERTEXT
    assert enrollment["commitment"] == START["commitment"]
    assert len(enrollment["challenge"]) == 44
    assert enrollment["wrapped_key"] is None
    new_id = enrollment["id"]

    assert client.get("/v1/enrollments/open").json()["id"] == new_id
    claimed = _claim(client, new_id).json()
    assert claimed["status"] == "claimed"
    assert claimed["approver_nonce"] == BYTES32

    revealed = _reveal(session_only, new_id).json()
    assert revealed["status"] == "revealed"
    assert revealed["joiner_nonce"] == BYTES32

    approved = _approve(client, new_id).json()
    assert approved["status"] == "approved"

    seen_by_new_device = session_only.get(f"/v1/enrollments/{new_id}").json()
    assert seen_by_new_device["status"] == "approved"
    assert seen_by_new_device["wrapped_key"] == CIPHERTEXT


def test_the_server_relays_the_wrapped_key_unchanged_and_stores_nothing_else(
    client: TestClient, enrollment_store: InMemoryEnrollmentStore
) -> None:
    """Only ciphertext and public values are ever held (invariant 1)."""
    _claim(client)
    _reveal(client)
    _approve(client)

    stored = enrollment_store.requests[SEEDED_ENROLLMENT_ID].enrollment
    assert stored.wrapped_key == CIPHERTEXT
    assert set(stored.model_dump()) == {
        "id",
        "device_id",
        "public_key",
        "commitment",
        "challenge",
        "status",
        "expires_at",
        "approver_nonce",
        "joiner_nonce",
        "wrapped_key",
    }


# --- each step happens once, in order --------------------------------------


def test_a_request_can_be_claimed_only_once(
    client: TestClient, second_client: TestClient
) -> None:
    """A second approving device cannot take over a claimed request."""
    assert _claim(client).status_code == 200

    _problem(_claim(second_client), 409, "enrollment.wrong_state")
    _problem(_claim(client), 409, "enrollment.wrong_state")


def test_the_new_device_cannot_reveal_before_an_approver_has_committed(
    session_only: TestClient,
) -> None:
    """Revealing first would let a relay choose its values afterwards."""
    _problem(_reveal(session_only), 409, "enrollment.wrong_state")


def test_a_value_is_revealed_only_once(client: TestClient) -> None:
    """Revealing again changes nothing."""
    _claim(client)
    assert _reveal(client).status_code == 200

    _problem(_reveal(client), 409, "enrollment.wrong_state")
    assert client.get(f"/v1/enrollments/{ID}").json()["status"] == "revealed"


def test_a_value_that_does_not_match_the_commitment_is_refused(
    client: TestClient, session_only: TestClient
) -> None:
    """A stolen session token cannot spoil a pairing with a made-up value."""
    _claim(client)

    junk = session_only.post(
        f"/v1/enrollments/{ID}/reveal", json={"joiner_nonce": OTHER_NONCE}
    )

    _problem(junk, 409, "enrollment.commitment_mismatch")
    assert client.get(f"/v1/enrollments/{ID}").json()["status"] == "claimed"
    # The real value can still be revealed afterwards.
    assert _reveal(session_only).json()["joiner_nonce"] == BYTES32


def test_the_commitment_check_agrees_with_the_browser(
    client: TestClient, session_only: TestClient
) -> None:
    """The shared fixture is also checked by the browser tests (ADR-0005)."""
    started = session_only.post(
        "/v1/enrollments",
        json={
            "device_id": FIXTURE["deviceId"],
            "public_key": FIXTURE["publicKey"],
            "commitment": FIXTURE["commitment"],
        },
    ).json()
    _claim(client, started["id"])

    revealed = session_only.post(
        f"/v1/enrollments/{started['id']}/reveal",
        json={"joiner_nonce": FIXTURE["joinerNonce"]},
    )

    assert revealed.status_code == 200
    assert (
        commitment(FIXTURE["deviceId"], FIXTURE["publicKey"], FIXTURE["joinerNonce"])
        == (FIXTURE["commitment"])
    )


@pytest.mark.parametrize("field", ["public_key", "commitment"])
def test_a_stored_value_that_is_not_base64_never_matches(field: str) -> None:
    """The check fails closed on a value it cannot decode."""
    stored = Enrollment(
        id=SEEDED_ENROLLMENT_ID,
        device_id=UUID(DEVICE_ID),
        public_key=CIPHERTEXT,
        commitment=commitment(DEVICE_ID, CIPHERTEXT, BYTES32),
        challenge=BYTES32,
        status="claimed",
        expires_at=datetime(2026, 11, 25, tzinfo=UTC),
    )
    assert commitment_matches(stored, BYTES32)

    broken = stored.model_construct(**(stored.model_dump() | {field: "not base64!"}))

    assert not commitment_matches(broken, BYTES32)
    assert not commitment_matches(stored, "not base64!")


@pytest.mark.parametrize("steps", [[], [_claim]], ids=["pending", "claimed"])
def test_a_request_cannot_be_approved_before_the_value_is_revealed(
    client: TestClient, steps: list[Any]
) -> None:
    """No key is delivered before both devices can compute the code."""
    for step in steps:
        step(client)

    _problem(_approve(client), 409, "enrollment.wrong_state")


def test_a_request_is_approved_only_once(client: TestClient) -> None:
    """A used request cannot carry a second key (single use)."""
    _claim(client)
    _reveal(client)
    assert _approve(client).status_code == 200

    again = client.post(
        f"/v1/enrollments/{ID}/approve", json={"wrapped_key": "c2Vjb25k"}
    )

    _problem(again, 409, "enrollment.wrong_state")
    assert client.get(f"/v1/enrollments/{ID}").json()["wrapped_key"] == CIPHERTEXT


def test_only_the_device_that_claimed_a_request_can_approve_or_reject_it(
    client: TestClient, second_client: TestClient
) -> None:
    """The person compared the code on one device; only it may finish."""
    _claim(client)
    _reveal(client)

    _problem(_approve(second_client), 409, "enrollment.wrong_state")
    _problem(
        second_client.post(f"/v1/enrollments/{ID}/reject"),
        409,
        "enrollment.wrong_state",
    )
    assert _approve(client).status_code == 200


@pytest.mark.parametrize("steps", [[_claim], [_claim, _reveal]])
def test_the_approver_can_reject_a_request_it_claimed(
    client: TestClient, steps: list[Any]
) -> None:
    """Mismatched codes end the pairing; nothing can be delivered after."""
    for step in steps:
        step(client)

    rejected = client.post(f"/v1/enrollments/{ID}/reject")

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    _problem(_approve(client), 409, "enrollment.wrong_state")
    _problem(_reveal(client), 409, "enrollment.wrong_state")


def test_a_request_nobody_claimed_cannot_be_rejected(client: TestClient) -> None:
    """Rejecting belongs to the device that claimed."""
    _problem(client.post(f"/v1/enrollments/{ID}/reject"), 409, "enrollment.wrong_state")


# --- expiry -----------------------------------------------------------------


@pytest.mark.parametrize(
    "steps",
    [[], [_claim], [_claim, _reveal]],
    ids=["pending", "claimed", "revealed"],
)
def test_an_expired_request_cannot_be_advanced(
    client: TestClient, enrollment_store: InMemoryEnrollmentStore, steps: list[Any]
) -> None:
    """After five minutes every step is refused."""
    for step in steps:
        step(client)
    enrollment_store.now += enrollment_store.LIFETIME

    for step in (_claim, _reveal, _approve):
        _problem(step(client), 409, "enrollment.wrong_state")
    assert client.get(f"/v1/enrollments/{ID}").json()["status"] == "expired"
    _problem(client.get("/v1/enrollments/open"), 404, "enrollment.not_found")


def test_an_expired_request_no_longer_gives_up_its_wrapped_key(
    client: TestClient, enrollment_store: InMemoryEnrollmentStore
) -> None:
    """Even ciphertext is not served past the expiry."""
    _claim(client)
    _reveal(client)
    _approve(client)
    enrollment_store.now += enrollment_store.LIFETIME

    body = client.get(f"/v1/enrollments/{ID}").json()

    assert body["status"] == "expired"
    assert body["wrapped_key"] is None


def test_a_request_still_works_just_before_it_expires(
    client: TestClient, enrollment_store: InMemoryEnrollmentStore
) -> None:
    enrollment_store.now += enrollment_store.LIFETIME - 1

    assert _claim(client).status_code == 200


def test_starting_a_new_request_ends_the_earlier_open_one(
    client: TestClient, session_only: TestClient
) -> None:
    """An approving device only ever sees one request to take up."""
    _claim(client)

    started = session_only.post("/v1/enrollments", json=START).json()

    assert client.get(f"/v1/enrollments/{ID}").json()["status"] == "expired"
    assert client.get("/v1/enrollments/open").json()["id"] == started["id"]
    _problem(_reveal(session_only), 409, "enrollment.wrong_state")


def test_there_is_no_open_request_once_it_is_claimed(client: TestClient) -> None:
    _claim(client)

    _problem(client.get("/v1/enrollments/open"), 404, "enrollment.not_found")


# --- who may do what ---------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/v1/enrollments/open", None),
        ("POST", f"/v1/enrollments/{ID}/claim", {"approver_nonce": BYTES32}),
        ("POST", f"/v1/enrollments/{ID}/approve", {"wrapped_key": CIPHERTEXT}),
        ("POST", f"/v1/enrollments/{ID}/reject", None),
    ],
)
def test_approving_needs_a_registered_devices_signature(
    session_only: TestClient, method: str, path: str, body: dict[str, str] | None
) -> None:
    """A stolen session token cannot approve its own pairing request (D-07)."""
    response = session_only.request(method, path, json=body)

    _problem(response, 401, "device.missing_signature")


def test_a_revoked_device_cannot_approve(
    client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """Revocation cuts a device off from pairing as from everything else."""
    _claim(client)
    _reveal(client)
    for stored in device_store.devices.values():
        stored.revoked = True

    _problem(_approve(client), 401, "device.not_authorized")
    assert client.headers["Authorization"]


def test_another_account_cannot_see_or_advance_a_request(
    client: TestClient, other_owner: TestClient
) -> None:
    """Pairing links one account's own devices only; other IDs look unknown."""
    unknown = "99999999-9999-4999-8999-999999999999"

    for enrollment_id in (ID, unknown):
        _problem(
            other_owner.get(f"/v1/enrollments/{enrollment_id}"),
            404,
            "enrollment.not_found",
        )
        _problem(_claim(other_owner, enrollment_id), 404, "enrollment.not_found")
        _problem(_reveal(other_owner, enrollment_id), 404, "enrollment.not_found")
        _problem(_approve(other_owner, enrollment_id), 404, "enrollment.not_found")
        _problem(
            other_owner.post(f"/v1/enrollments/{enrollment_id}/reject"),
            404,
            "enrollment.not_found",
        )
    _problem(other_owner.get("/v1/enrollments/open"), 404, "enrollment.not_found")
    assert client.get(f"/v1/enrollments/{ID}").json()["status"] == "pending"


def test_another_accounts_new_request_does_not_end_mine(
    client: TestClient, other_owner: TestClient
) -> None:
    other_owner.post("/v1/enrollments", json=START)

    assert client.get("/v1/enrollments/open").json()["id"] == ID


# --- input ------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        START | {"commitment": "c2hvcnQ="},
        START | {"commitment": BYTES32 + "AAAA"},
        START | {"commitment": "!" * 44},
        START | {"public_key": "not base64!"},
        START | {"device_id": "not-a-uuid"},
        START | {"owner_id": OTHER_OWNER_ID},
        {"device_id": DEVICE_ID, "public_key": CIPHERTEXT},
    ],
)
def test_a_malformed_start_is_rejected(
    session_only: TestClient, body: dict[str, str]
) -> None:
    """Values are fixed-size, and no owner can be named in the body."""
    assert session_only.post("/v1/enrollments", json=body).status_code == 422


@pytest.mark.parametrize(
    ("step", "body"),
    [
        ("claim", {"approver_nonce": "c2hvcnQ="}),
        ("claim", {}),
        ("reveal", {"joiner_nonce": "c2hvcnQ="}),
        ("approve", {"wrapped_key": ""}),
        ("approve", {"wrapped_key": "A" * 4097}),
    ],
)
def test_a_malformed_step_is_rejected(
    client: TestClient, step: str, body: dict[str, str]
) -> None:
    assert client.post(f"/v1/enrollments/{ID}/{step}", json=body).status_code == 422


def test_a_malformed_request_id_is_rejected(client: TestClient) -> None:
    assert client.get("/v1/enrollments/not-a-uuid").status_code == 422


def test_request_ids_are_uuids_the_server_chose(session_only: TestClient) -> None:
    """The new device cannot pick an ID that collides with another request."""
    first = session_only.post("/v1/enrollments", json=START).json()["id"]
    second = session_only.post("/v1/enrollments", json=START).json()["id"]

    assert UUID(first) != UUID(second)
