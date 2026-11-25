"""Revoking a device (PRD DEV-003, DEV-004, DEV-010; AC-20, AC-05; ADR-0005).

A revoked device is refused on every route from the next request on, even
with a token that is still valid and a correct signature, and its ID can
never be used again. Revoking needs a registered device's signature and a
password entered in the last few minutes.
"""

import json
import time
from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.api.cases import Case
from tests.api.conftest import (
    FakeDatabase,
    InMemoryDeviceStore,
    InMemoryEnrollmentStore,
    InMemoryRecoveryStore,
    InMemoryRequestCounters,
)
from tests.api.test_devices import SIGNED_CASES
from tests.auth.devices import (
    DEVICE_ID,
    OTHER_DEVICE_ID,
    DeviceAuth,
    TestDevice,
)
from tests.auth.tokens import AUDIENCE, ISSUER, OTHER_OWNER_ID, OWNER_ID, REMOVE, Signer
from warmly.api.devices import REAUTHENTICATION_SECONDS
from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.app import create_app
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier
from warmly.logs import LOGGER_NAME

REVOKE = f"/v1/devices/{DEVICE_ID}/revoke"
REVOKE_OTHER = f"/v1/devices/{OTHER_DEVICE_ID}/revoke"


def _problem(response: Any, status: int, code: str) -> None:
    """Check a response is a problem with the given status and code."""
    assert response.status_code == status, response.text
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["code"] == code


def _client(
    app: FastAPI, signer: Signer, device: TestDevice, **claims: Any
) -> TestClient:
    """Return a client for the test owner on ``device``, with token overrides."""
    client = TestClient(
        app, headers={"Authorization": f"Bearer {signer.token(**claims)}"}
    )
    client.auth = DeviceAuth(device)
    return client


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
    return _client(app, signer, second_device)


# --- revoking ----------------------------------------------------------------


def test_revoking_another_device_marks_it_and_records_who_asked(
    client: TestClient, second_device: TestDevice, device_store: InMemoryDeviceStore
) -> None:
    """Revoking another device marks it and records who asked."""
    response = client.post(REVOKE_OTHER)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == OTHER_DEVICE_ID
    assert body["revoked_at"] is not None
    assert body["is_current"] is False
    assert device_store.ledger == [(UUID(OTHER_DEVICE_ID), UUID(DEVICE_ID))]
    listed = {
        d["id"]: d["revoked_at"] for d in client.get("/v1/devices").json()["devices"]
    }
    assert listed[OTHER_DEVICE_ID] is not None
    assert listed[DEVICE_ID] is None


@pytest.mark.parametrize(
    "case",
    # The registration case signs with its own, unregistered key; a revoked
    # device trying that is covered by the re-registration test below.
    [case for case in SIGNED_CASES if case.signed_by is None],
    ids=lambda c: f"{c.method} {c.path}",
)
def test_a_revoked_device_is_refused_on_every_signed_route(
    client: TestClient, second_client: TestClient, case: Case
) -> None:
    """A still-valid token and a correct signature no longer help (AC-20)."""
    assert client.post(REVOKE_OTHER).status_code == 200

    response = second_client.request(case.method, case.path, json=case.body)

    _problem(response, 401, "device.revoked")


def test_the_example_from_the_issue(
    client: TestClient, second_client: TestClient
) -> None:
    """POST /v1/sync/operations from a device revoked a moment ago is a 401."""
    client.post(REVOKE_OTHER)

    response = second_client.post("/v1/sync/operations", json={"operations": []})

    _problem(response, 401, "device.revoked")


def test_a_revoked_device_cannot_register_the_same_id_again(
    client: TestClient,
    session_only: TestClient,
    second_device: TestDevice,
) -> None:
    """Rejoining means a new device ID and a new enrollment (DEV-003)."""
    client.post(REVOKE_OTHER)
    content = json.dumps(second_device.registration()).encode()

    again = session_only.post(
        "/v1/devices",
        content=content,
        headers=second_device.headers("POST", "/v1/devices", content)
        | {"Content-Type": "application/json"},
    )

    _problem(again, 409, "device.already_registered")


def test_a_device_can_revoke_itself_and_is_then_refused(
    client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """Revoking the current device is allowed (AC-20)."""
    response = client.post(REVOKE)

    assert response.status_code == 200
    assert response.json()["is_current"] is True
    assert response.json()["revoked_at"] is not None
    assert device_store.ledger == [(UUID(DEVICE_ID), UUID(DEVICE_ID))]
    _problem(client.get("/v1/devices"), 401, "device.revoked")
    _problem(client.post(REVOKE), 401, "device.revoked")


def test_revoking_twice_keeps_the_first_revocation(
    client: TestClient, second_device: TestDevice, device_store: InMemoryDeviceStore
) -> None:
    """Revoking twice keeps the first revocation."""
    first = client.post(REVOKE_OTHER).json()

    second = client.post(REVOKE_OTHER).json()

    assert second["revoked_at"] == first["revoked_at"]
    assert len(device_store.ledger) == 1


def test_a_revoked_device_cannot_revoke_the_others(
    client: TestClient, second_client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """A revoked device cannot revoke the others."""
    client.post(REVOKE_OTHER)

    _problem(second_client.post(REVOKE), 401, "device.revoked")
    assert not device_store.devices[UUID(DEVICE_ID)].revoked


# --- who may revoke ------------------------------------------------------------


def test_another_owner_cannot_revoke_my_device(
    app: FastAPI, signer: Signer, device_store: InMemoryDeviceStore
) -> None:
    """Their request gets the same 404 as for a device that does not exist."""
    theirs = TestDevice(device_id="d0000000-0000-4000-8000-0000000000ee")
    device_store.add(OTHER_OWNER_ID, theirs)
    other = _client(app, signer, theirs, sub=OTHER_OWNER_ID)
    unknown = "/v1/devices/99999999-9999-4999-8999-999999999999/revoke"

    mine = other.post(REVOKE)
    nobodys = other.post(unknown)

    _problem(mine, 404, "device.not_found")
    _problem(nobodys, 404, "device.not_found")
    assert not device_store.devices[UUID(DEVICE_ID)].revoked
    assert not device_store.ledger


def test_a_session_token_alone_cannot_revoke(
    session_only: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """A stolen token cannot lock the owner out of their own devices."""
    _problem(session_only.post(REVOKE), 401, "device.missing_signature")
    assert not device_store.devices[UUID(DEVICE_ID)].revoked


@pytest.mark.parametrize(
    "amr",
    [
        REMOVE,
        None,
        [],
        "password",
        ["password"],
        [{"method": "otp", "timestamp": int(time.time())}],
        [{"method": "password"}],
        [{"method": "password", "timestamp": "now"}],
        [{"method": "password", "timestamp": True}],
        [
            {
                "method": "password",
                "timestamp": int(time.time()) - REAUTHENTICATION_SECONDS - 1,
            }
        ],
        [{"method": "password", "timestamp": int(time.time()) + 3600}],
        [None, 7],
    ],
    ids=[
        "no claim",
        "null",
        "empty",
        "not a list",
        "names without times",
        "another method",
        "no time",
        "time as text",
        "time as a boolean",
        "too long ago",
        "in the future",
        "junk entries",
    ],
)
def test_revoking_needs_a_password_entered_recently(
    app: FastAPI,
    signer: Signer,
    device: TestDevice,
    second_device: TestDevice,
    device_store: InMemoryDeviceStore,
    amr: Any,
) -> None:
    """Someone who picks up an unlocked device cannot revoke the others."""
    stale = _client(app, signer, device, amr=amr)

    _problem(stale.post(REVOKE_OTHER), 403, "auth.reauthentication_required")
    assert not device_store.devices[UUID(OTHER_DEVICE_ID)].revoked
    assert not device_store.ledger
    # Everything else still works with that session.
    assert stale.get("/v1/devices").status_code == 200


def test_the_latest_password_entry_is_the_one_that_counts(
    app: FastAPI, signer: Signer, device: TestDevice, second_device: TestDevice
) -> None:
    """The latest password entry is the one that counts."""
    now = int(time.time())
    fresh = _client(
        app,
        signer,
        device,
        amr=[
            {"method": "password", "timestamp": now - 86_400},
            {"method": "otp", "timestamp": now},
            {"method": "password", "timestamp": now - 10},
        ],
    )

    assert fresh.post(REVOKE_OTHER).status_code == 200


def test_the_password_window_is_judged_by_the_servers_clock(
    signer: Signer,
    recovery_store: InMemoryRecoveryStore,
    device_store: InMemoryDeviceStore,
    enrollment_store: InMemoryEnrollmentStore,
    device: TestDevice,
    second_device: TestDevice,
) -> None:
    """Five minutes exactly is still accepted; one second more is not."""
    entered = int(time.time())
    clock = [float(entered + REAUTHENTICATION_SECONDS)]
    app = create_app(
        database=FakeDatabase(),
        token_verifier=TokenVerifier(
            issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
        ),
        recovery_store=recovery_store,
        device_store=device_store,
        enrollment_store=enrollment_store,
        request_counters=InMemoryRequestCounters(),
        clock=lambda: clock[0],
    )
    token = signer.token(amr=[{"method": "password", "timestamp": entered}])

    def revoke(target: str) -> Any:
        """Ask to revoke a device, signed at the application's current time."""
        path = f"/v1/devices/{target}/revoke"
        headers = device.headers("POST", path, timestamp=int(clock[0]))
        return TestClient(app).post(
            path, headers=headers | {"Authorization": f"Bearer {token}"}
        )

    clock[0] += 1
    _problem(revoke(OTHER_DEVICE_ID), 403, "auth.reauthentication_required")
    clock[0] -= 1
    assert revoke(OTHER_DEVICE_ID).status_code == 200


def test_a_malformed_device_id_is_rejected(client: TestClient) -> None:
    """A malformed device id is rejected."""
    assert client.post("/v1/devices/not-a-uuid/revoke").status_code == 422


def test_the_revocation_is_not_logged_with_the_device_id(
    client: TestClient, second_device: TestDevice, caplog: pytest.LogCaptureFixture
) -> None:
    """The revocation is not logged with the device id."""
    caplog.set_level("INFO", logger=LOGGER_NAME)

    client.post(REVOKE_OTHER)

    logged = [record for record in caplog.records if record.name == LOGGER_NAME]
    assert logged
    assert all(OTHER_DEVICE_ID not in str(record.__dict__) for record in logged)
