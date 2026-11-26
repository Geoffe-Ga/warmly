"""Recovery envelope routes (PRD SEC-003, DEV-001 path B; AC-18).

The store here is the in-memory double. The same rules are tested against
PostgreSQL, including cross-owner access, in tests/db/test_recovery_store.py.
"""

import base64
from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.api.conftest import InMemoryRecoveryStore
from tests.auth.devices import ENROLLMENT_KEY
from tests.auth.tokens import OTHER_OWNER_ID, OWNER_ID, Signer
from warmly.api.errors import PROBLEM_MEDIA_TYPE

URL = "/v1/recovery-envelope"
WRAPPED_A = "QUFBQQ=="
WRAPPED_B = "QkJCQg=="
# A second well-formed enrollment key, for a rotation that tries to send one.
OTHER_ENROLLMENT_KEY = base64.b64encode(bytes(range(32, 64))).decode()


def _put(client: TestClient, expected: int, wrapped: str = WRAPPED_A) -> dict[str, Any]:
    """Send a PUT and return the response as a dictionary with its status."""
    body: dict[str, Any] = {
        "expected_version": expected,
        "format_version": 1,
        "wrapped_key": wrapped,
    }
    if expected == 0:
        body["device_enrollment_key"] = ENROLLMENT_KEY
    response = client.put(URL, json=body)
    return {"status": response.status_code, **response.json()}


@pytest.fixture
def empty(recovery_store: InMemoryRecoveryStore) -> InMemoryRecoveryStore:
    """Return the store with no envelopes, as for a brand-new account."""
    recovery_store.envelopes.clear()
    return recovery_store


def test_a_new_account_has_no_envelope(
    client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """Before keys are created the answer is a clear 404, not an empty value."""
    response = client.get(URL)

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["code"] == "recovery.not_found"


def test_creating_stores_version_one_and_reads_back_unchanged(
    client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """The server stores the opaque value exactly as sent (AC-18)."""
    created = _put(client, 0)

    assert created == {
        "status": 200,
        "version": 1,
        "format_version": 1,
        "wrapped_key": WRAPPED_A,
    }
    assert client.get(URL).json() == {
        "version": 1,
        "format_version": 1,
        "wrapped_key": WRAPPED_A,
    }
    assert empty.envelopes[UUID(OWNER_ID)].wrapped_key == WRAPPED_A


def test_creating_twice_is_a_conflict_and_keeps_the_first(
    client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """A second device cannot silently replace the keys the first made."""
    _put(client, 0, WRAPPED_A)

    second = _put(client, 0, WRAPPED_B)

    assert second["status"] == 409
    assert second["code"] == "recovery.version_conflict"
    assert client.get(URL).json()["wrapped_key"] == WRAPPED_A


def test_rotation_replaces_the_expected_version_only(
    client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """Rotation moves the version on by one and swaps the wrapped key."""
    _put(client, 0, WRAPPED_A)

    rotated = _put(client, 1, WRAPPED_B)

    assert rotated["status"] == 200
    assert rotated["version"] == 2
    assert client.get(URL).json()["wrapped_key"] == WRAPPED_B


@pytest.mark.parametrize("stale", [0, 2, 7])
def test_a_stale_rotation_changes_nothing(
    client: TestClient, empty: InMemoryRecoveryStore, stale: int
) -> None:
    """An interrupted or out-of-date rotation leaves the old key valid."""
    _put(client, 0, WRAPPED_A)

    response = _put(client, stale, WRAPPED_B)

    assert response["status"] == 409
    assert client.get(URL).json() == {
        "version": 1,
        "format_version": 1,
        "wrapped_key": WRAPPED_A,
    }


def test_rotating_before_creating_is_a_conflict(
    client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """There is nothing at version 1 to replace."""
    assert _put(client, 1)["status"] == 409
    assert not empty.envelopes


def test_each_account_has_its_own_envelope(
    app: FastAPI, signer: Signer, empty: InMemoryRecoveryStore
) -> None:
    """One account can neither read nor replace another's envelope (AC-05)."""
    first = TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})
    second = TestClient(
        app,
        headers={"Authorization": f"Bearer {signer.token(sub=OTHER_OWNER_ID)}"},
    )
    _put(first, 0, WRAPPED_A)

    assert second.get(URL).status_code == 404
    # Replacing an envelope must be signed by a device; this account has none.
    assert _put(second, 1, WRAPPED_B)["status"] == 401
    assert _put(second, 0, WRAPPED_B)["status"] == 200
    assert first.get(URL).json()["wrapped_key"] == WRAPPED_A
    assert second.get(URL).json()["wrapped_key"] == WRAPPED_B


def test_an_owner_named_in_the_request_is_rejected_not_obeyed(
    client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """The body has no owner field; adding one is an invalid request."""
    response = client.put(
        URL,
        json={
            "expected_version": 0,
            "format_version": 1,
            "wrapped_key": WRAPPED_A,
            "owner_id": OTHER_OWNER_ID,
        },
    )

    assert response.status_code == 422
    assert not empty.envelopes


@pytest.mark.parametrize(
    "body",
    [
        {"expected_version": -1, "format_version": 1, "wrapped_key": WRAPPED_A},
        {"expected_version": 0, "format_version": 0, "wrapped_key": WRAPPED_A},
        {"expected_version": 0, "format_version": 2, "wrapped_key": WRAPPED_A},
        {"expected_version": 0, "format_version": 1, "wrapped_key": ""},
        {"expected_version": 0, "format_version": 1, "wrapped_key": "not base64!"},
        {"expected_version": 0, "format_version": 1, "wrapped_key": "A" * 4097},
        {"expected_version": 0, "format_version": 1},
    ],
)
def test_a_malformed_envelope_is_refused_and_never_echoed(
    client: TestClient, empty: InMemoryRecoveryStore, body: dict[str, Any]
) -> None:
    """Validation names the field but never repeats the value."""
    response = client.put(URL, json=body)

    assert response.status_code == 422
    assert "not base64!" not in response.text
    assert not empty.envelopes


def test_creating_needs_the_enrollment_key_and_rotating_must_not_send_one(
    client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """The key is set once, with the first envelope, and never replaced."""
    without = client.put(
        URL,
        json={"expected_version": 0, "format_version": 1, "wrapped_key": WRAPPED_A},
    )
    assert without.status_code == 422
    assert not empty.envelopes

    _put(client, 0, WRAPPED_A)
    assert empty.enrollment_keys[UUID(OWNER_ID)] == ENROLLMENT_KEY

    with_one = client.put(
        URL,
        json={
            "expected_version": 1,
            "format_version": 1,
            "wrapped_key": WRAPPED_B,
            "device_enrollment_key": OTHER_ENROLLMENT_KEY,
        },
    )
    assert with_one.status_code == 422
    assert empty.enrollment_keys[UUID(OWNER_ID)] == ENROLLMENT_KEY


@pytest.mark.parametrize(
    "not_a_key",
    [
        "",
        "c2hvcnQ=",
        base64.b64encode(bytes(31)).decode(),
        base64.b64encode(bytes(33)).decode(),
        base64.b64encode(bytes(64)).decode(),
        ENROLLMENT_KEY.rstrip("="),
        ENROLLMENT_KEY.replace("=", "!"),
    ],
)
def test_the_enrollment_key_must_be_the_size_of_a_public_key(
    client: TestClient, empty: InMemoryRecoveryStore, not_a_key: str
) -> None:
    """Anything but 32 bytes of base64 is refused before it is stored."""
    response = client.put(
        URL,
        json={
            "expected_version": 0,
            "format_version": 1,
            "wrapped_key": WRAPPED_A,
            "device_enrollment_key": not_a_key,
        },
    )

    assert response.status_code == 422
    assert not empty.envelopes


def test_creating_needs_only_the_session_but_rotating_needs_a_device(
    session_only: TestClient, client: TestClient, empty: InMemoryRecoveryStore
) -> None:
    """A stolen token cannot replace the envelope and lock the user out (SEC-006)."""
    assert _put(session_only, 0, WRAPPED_A)["status"] == 200
    assert session_only.get(URL).status_code == 200

    stolen = _put(session_only, 1, WRAPPED_B)

    assert stolen["status"] == 401
    assert stolen["code"] == "device.missing_signature"
    assert empty.envelopes[UUID(OWNER_ID)].wrapped_key == WRAPPED_A
    assert _put(client, 1, WRAPPED_B)["status"] == 200
