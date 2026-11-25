"""``GET /v1/sync/changes`` (PRD SYNC-002, SYNC-003, DEV-002; AC-05; ADR-0006).

These tests run the route on in-memory stores. The feed query itself, and
the guarantee that a reader never skips a change, are tested against
PostgreSQL in ``tests/db/test_sync_feed.py``.
"""

import logging
from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.api.cases import CIPHERTEXT, OPERATION
from tests.api.conftest import SYNCED_AT, InMemoryDeviceStore, InMemorySyncStore
from tests.auth.devices import DEVICE_ID, DeviceAuth, TestDevice
from tests.auth.tokens import OTHER_OWNER_ID, Signer
from warmly.db.sync_store import etag_of
from warmly.logs import LOGGER_NAME

URL = "/v1/sync/changes"
OPERATIONS = "/v1/sync/operations"
THEIR_DEVICE = "d0000000-0000-4000-8000-0000000000cc"


def _record(number: int) -> str:
    """Return a record ID."""
    return f"10000000-0000-4000-8000-{number:012d}"


def _write(client: TestClient, number: int, base: int = 0, **changes: Any) -> None:
    """Apply one change to record ``number``."""
    operation = OPERATION | {
        "op_id": f"00000000-0000-4000-8000-{number:06d}{base:06d}",
        "record_id": _record(number),
        "base_revision": base,
    }
    response = client.post(OPERATIONS, json={"operations": [operation | changes]})
    assert response.json()["results"][0]["status"] == "applied", response.text


def _pull(client: TestClient, cursor: str | None = "0") -> dict[str, Any]:
    """Ask for one page and return it."""
    response = client.get(URL, params=None if cursor is None else {"cursor": cursor})
    assert response.status_code == 200, response.text
    page: dict[str, Any] = response.json()
    return page


def _places(page: dict[str, Any]) -> list[tuple[str, int, int]]:
    """Return each change's record, revision and sequence."""
    return [
        (change["record_id"], change["revision"], change["sequence"])
        for change in page["changes"]
    ]


@pytest.fixture
def other(
    app: FastAPI, signer: Signer, device_store: InMemoryDeviceStore
) -> TestClient:
    """Return a client signed in as a second account on its own device."""
    device = TestDevice(device_id=THEIR_DEVICE)
    device_store.add(OTHER_OWNER_ID, device)
    token = signer.token(sub=OTHER_OWNER_ID)
    client = TestClient(app, headers={"Authorization": f"Bearer {token}"})
    client.auth = DeviceAuth(device)
    return client


def test_an_account_with_no_records_gets_an_empty_page(client: TestClient) -> None:
    """A new device starts at 0, and the cursor is 0 when none is sent."""
    empty = {"changes": [], "next_cursor": "0", "has_more": False}

    assert _pull(client) == empty
    assert _pull(client, None) == empty


def test_a_change_carries_the_record_as_it_was_stored(client: TestClient) -> None:
    """The payload comes back as the text that was sent (SYNC-002)."""
    _write(client, 1, schema_version=4)

    assert _pull(client) == {
        "changes": [
            {
                "record_id": _record(1),
                "type": 1,
                "revision": 1,
                "sequence": 1,
                "schema_version": 4,
                "tombstone": False,
                "etag": etag_of(CIPHERTEXT),
                "payload": CIPHERTEXT,
            }
        ],
        "next_cursor": "1",
        "has_more": False,
    }


def test_changes_come_in_the_order_they_were_accepted(client: TestClient) -> None:
    """A record appears once, at the place of its latest change."""
    _write(client, 1)
    _write(client, 2)
    _write(client, 1, base=1)

    page = _pull(client)

    assert _places(page) == [(_record(2), 1, 2), (_record(1), 2, 3)]
    assert page["next_cursor"] == "3"


def test_only_changes_after_the_cursor_are_returned(client: TestClient) -> None:
    """A device that is up to date gets nothing and keeps its cursor."""
    for number in (1, 2, 3):
        _write(client, number)

    assert _places(_pull(client, "2")) == [(_record(3), 1, 3)]
    assert _pull(client, "3") == {"changes": [], "next_cursor": "3", "has_more": False}


def test_a_deleted_record_is_in_the_feed_without_a_payload(client: TestClient) -> None:
    """Other devices learn about a deletion from its tombstone (SYNC-005)."""
    _write(client, 1)
    _write(client, 1, base=1, tombstone=True, payload=None)

    (change,) = _pull(client)["changes"]

    assert (change["revision"], change["tombstone"]) == (2, True)
    assert change["payload"] is None
    assert change["etag"] == etag_of(None)


def test_the_feed_is_paged_and_every_change_is_seen_exactly_once(
    client: TestClient, sync_store: InMemorySyncStore
) -> None:
    """Following ``next_cursor`` while ``has_more`` reaches every record."""
    sync_store.page_size = 2
    for number in range(1, 6):
        _write(client, number)

    first = _pull(client)
    second = _pull(client, first["next_cursor"])
    third = _pull(client, second["next_cursor"])

    assert [page["has_more"] for page in (first, second, third)] == [True, True, False]
    assert [page["next_cursor"] for page in (first, second, third)] == ["2", "4", "5"]
    seen = [place for page in (first, second, third) for place in _places(page)]
    assert seen == [(_record(number), 1, number) for number in range(1, 6)]


def test_a_page_that_ends_exactly_at_the_last_change_has_no_more(
    client: TestClient, sync_store: InMemorySyncStore
) -> None:
    """A full last page does not promise a page that is not there."""
    sync_store.page_size = 2
    _write(client, 1)
    _write(client, 2)

    assert _pull(client)["has_more"] is False


def test_another_account_sees_nothing_of_this_ones_records(
    client: TestClient, other: TestClient
) -> None:
    """The feed is the caller's own, whatever cursor is sent (AC-16)."""
    _write(client, 1)
    _write(client, 2)

    assert _pull(other) == {"changes": [], "next_cursor": "0", "has_more": False}
    assert other.get(URL, params={"cursor": "1"}).status_code == 409


def test_two_accounts_each_get_their_own_feed(
    client: TestClient, other: TestClient
) -> None:
    """Each account's sequence starts at 1 and counts only its own changes."""
    _write(client, 1)
    _write(client, 2)
    _write(other, 7)

    assert _places(_pull(other)) == [(_record(7), 1, 1)]
    assert _places(_pull(client)) == [(_record(1), 1, 1), (_record(2), 1, 2)]


@pytest.mark.parametrize("cursor", ["2", "999", str(2**63 - 1), str(2**63), "9" * 64])
def test_a_cursor_the_account_was_never_given_is_refused(
    client: TestClient, cursor: str
) -> None:
    """The client is told to start again from 0, and gets no data."""
    _write(client, 1)

    response = client.get(URL, params={"cursor": cursor})

    assert response.status_code == 409
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "sync.cursor_unknown"
    assert "changes" not in response.json()
    assert cursor not in response.text


@pytest.mark.parametrize("cursor", ["-1", "abc", "1.5", "", " 1", "1" * 65, "\u0661"])
def test_a_malformed_cursor_is_a_422(client: TestClient, cursor: str) -> None:
    """Only ASCII digits are a cursor."""
    response = client.get(URL, params={"cursor": cursor})

    assert response.status_code == 422
    assert response.json()["code"] == "request.invalid"


def test_no_field_can_ask_for_another_accounts_feed(
    client: TestClient, other: TestClient
) -> None:
    """An owner ID in the query is ignored: the token decides (AC-16)."""
    _write(other, 7)

    response = client.get(URL, params={"cursor": "0", "owner_id": OTHER_OWNER_ID})

    assert response.json()["changes"] == []


def test_reaching_the_end_of_the_feed_records_the_devices_last_sync(
    client: TestClient,
) -> None:
    """Manage Devices shows when each device last caught up (DEV-002)."""
    assert client.get("/v1/devices").json()["devices"][0]["last_sync_at"] is None

    _pull(client)

    (device,) = client.get("/v1/devices").json()["devices"]
    assert device["last_sync_at"] == SYNCED_AT.isoformat().replace("+00:00", "Z")


def test_a_page_with_more_to_come_does_not_count_as_a_sync(
    client: TestClient,
    sync_store: InMemorySyncStore,
    device_store: InMemoryDeviceStore,
) -> None:
    """Only the final page means the device has everything."""
    sync_store.page_size = 1
    _write(client, 1)
    _write(client, 2)
    stored = device_store.devices[UUID(DEVICE_ID)]

    first = _pull(client)
    assert stored.device.last_sync_at is None

    _pull(client, first["next_cursor"])
    assert stored.device.last_sync_at == SYNCED_AT


def test_a_refused_cursor_does_not_count_as_a_sync(
    client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """A device that was told to start again has not caught up."""
    client.get(URL, params={"cursor": "5"})

    assert device_store.devices[UUID(DEVICE_ID)].device.last_sync_at is None


def test_the_page_is_still_returned_when_the_last_sync_time_cannot_be_stored(
    client: TestClient,
    device_store: InMemoryDeviceStore,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The read succeeded; a time shown in Manage Devices must not undo it."""
    _write(client, 1)
    device_store.cannot_mark = True
    caplog.set_level(logging.WARNING, logger=LOGGER_NAME)

    page = _pull(client)

    assert _places(page) == [(_record(1), 1, 1)]
    failures = [record.fields for record in caplog.records if hasattr(record, "fields")]
    # Logged by a fixed name, with nothing about the account or device.
    assert {"event": "sync.last_sync_failed"} in failures


def test_only_the_calling_device_is_marked_as_synced(
    client: TestClient, other: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """One device catching up says nothing about any other."""
    _pull(client)

    assert device_store.devices[UUID(THEIR_DEVICE)].device.last_sync_at is None


def test_a_revoked_device_gets_no_changes(
    client: TestClient, device_store: InMemoryDeviceStore
) -> None:
    """Revocation is checked on every request to the feed (DEV-003, AC-03)."""
    _write(client, 1)
    device_store.devices[UUID(DEVICE_ID)].revoked = True

    response = client.get(URL)

    assert response.status_code == 401
    assert response.json()["code"] == "device.revoked"
    assert CIPHERTEXT not in response.text


def test_the_feed_needs_a_session_and_a_device_signature(
    anonymous: TestClient, session_only: TestClient, client: TestClient
) -> None:
    """A stolen token alone cannot download an account's ciphertext."""
    _write(client, 1)

    for stranger in (anonymous, session_only):
        response = stranger.get(URL)
        assert response.status_code == 401
        assert CIPHERTEXT not in response.text
