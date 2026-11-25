"""``POST /v1/sync/operations`` (PRD SYNC-002, SYNC-003, SYNC-008; ADR-0006).

These tests run the route on an in-memory store. The PostgreSQL store is
tested against the same scenario table in ``tests/db/test_sync_store.py``.
"""

from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from tests.api.cases import CIPHERTEXT, OPERATION
from tests.api.conftest import InMemorySyncStore
from tests.auth.tokens import OWNER_ID
from tests.sync_scenarios import SCENARIO_IDS, SCENARIOS, expected, wire
from warmly.api.stub import STUB_HEADER
from warmly.schemas.sync import MAX_OPERATIONS_PER_BATCH

URL = "/v1/sync/operations"
OTHER_OWNER = "99999999-9999-4999-8999-999999999999"


def _op(number: int, **changes: Any) -> dict[str, Any]:
    """Build an operation with its own ID."""
    return OPERATION | {"op_id": f"00000000-0000-4000-8000-{number:012d}"} | changes


def _send(client: TestClient, *operations: dict[str, Any]) -> list[dict[str, Any]]:
    """Send a batch and return its results."""
    response = client.post(URL, json={"operations": list(operations)})
    assert response.status_code == 200, response.text
    results: list[dict[str, Any]] = response.json()["results"]
    return results


@pytest.mark.parametrize(("name", "steps"), SCENARIOS, ids=SCENARIO_IDS)
def test_the_route_follows_the_adr_0006_scenario_table(
    client: TestClient, name: str, steps: list[dict[str, Any]]
) -> None:
    """Each scenario gets the statuses the protocol defines, step by step."""
    for step in steps:
        assert _send(client, wire(step["operation"])) == [expected(step)], name


def test_a_real_route_is_not_marked_as_a_stub(client: TestClient) -> None:
    """Operations are stored now, so the stub marker is gone."""
    response = client.post(URL, json={"operations": [OPERATION]})

    assert STUB_HEADER not in response.headers
    assert response.json()["results"][0]["status"] == "applied"


def test_a_batch_is_answered_in_order_and_each_operation_stands_alone(
    client: TestClient,
) -> None:
    """One refused operation does not stop the ones after it (SYNC-003)."""
    other_record = "66666666-6666-4666-8666-666666666666"

    results = _send(
        client,
        _op(1),
        _op(2, base_revision=5),
        _op(3, base_revision=1),
        _op(4, record_id=other_record, base_revision=3),
        _op(5, record_id=other_record),
        _op(1),
    )

    assert [(r["op_id"][-1], r["status"]) for r in results] == [
        ("1", "applied"),
        ("2", "conflict"),
        ("3", "applied"),
        ("4", "rejected"),
        ("5", "applied"),
        ("1", "duplicate"),
    ]
    assert [r["revision"] for r in results] == [1, None, 2, None, 1, 1]
    assert [r["current_revision"] for r in results] == [None, 1, None, None, None, None]


def test_a_repeated_operation_changes_nothing(
    client: TestClient, sync_store: InMemorySyncStore
) -> None:
    """A retry returns the original revision and stores nothing new (SYNC-008)."""
    _send(client, _op(1))
    _send(client, _op(2, base_revision=1, payload="bmV3ZXI="))
    before = sync_store.records.copy()

    assert _send(client, _op(1))[0] == {
        "op_id": _op(1)["op_id"],
        "status": "duplicate",
        "revision": 1,
        "current_revision": None,
    }

    assert sync_store.records == before


def test_a_refused_change_is_not_stored(
    client: TestClient, sync_store: InMemorySyncStore
) -> None:
    """A stale change leaves the stored ciphertext exactly as it was."""
    _send(client, _op(1), _op(2, base_revision=1, payload="bmV3ZXI="))
    before = sync_store.records.copy()

    results = _send(client, _op(3, base_revision=1, payload="c3RhbGU="))

    assert results[0]["status"] == "conflict"
    assert results[0]["current_revision"] == 2
    assert sync_store.records == before
    assert "c3RhbGU=" not in str(sync_store.records)


def test_the_payload_is_stored_exactly_as_sent(
    client: TestClient, sync_store: InMemorySyncStore
) -> None:
    """The server keeps the ciphertext text and never decodes it."""
    _send(client, _op(1))

    ((_owner, _record), stored) = next(iter(sync_store.records.items()))
    assert stored == (1, 1, False, CIPHERTEXT)


def test_records_belong_to_the_account_in_the_token(
    client: TestClient, sync_store: InMemorySyncStore
) -> None:
    """The owner comes from the verified token and from nowhere else."""
    _send(client, _op(1))

    assert {owner for owner, _record in sync_store.records} == {UUID(OWNER_ID)}


@pytest.mark.parametrize(
    "field", ["owner_id", "owner", "account_id", "device_id", "revision"]
)
def test_an_operation_cannot_carry_an_owner_or_any_unknown_field(
    client: TestClient, sync_store: InMemorySyncStore, field: str
) -> None:
    """Unknown fields are refused, so ownership cannot be smuggled in."""
    response = client.post(URL, json={"operations": [OPERATION | {field: OTHER_OWNER}]})

    assert response.status_code == 422
    assert not sync_store.records


@pytest.mark.parametrize(
    "body",
    [
        {"operations": []},
        {"operations": [OPERATION] * (MAX_OPERATIONS_PER_BATCH + 1)},
        {"operations": [OPERATION | {"payload": None}]},
        {"operations": [OPERATION | {"tombstone": True}]},
        {"operations": [OPERATION | {"payload": "not base64!"}]},
        {"operations": [OPERATION | {"base_revision": -1}]},
        {"operations": [OPERATION | {"type": 256}]},
        {"operations": [OPERATION | {"record_id": "not-a-uuid"}]},
        {"operations": [OPERATION | {"schema_version": 0}]},
        {},
    ],
    ids=[
        "empty batch",
        "too many operations",
        "write without payload",
        "tombstone with payload",
        "payload that is not base64",
        "negative base revision",
        "type out of range",
        "record ID that is not a UUID",
        "schema version 0",
        "no operations field",
    ],
)
def test_a_malformed_batch_is_refused_whole_and_stores_nothing(
    client: TestClient, sync_store: InMemorySyncStore, body: dict[str, Any]
) -> None:
    """Validation happens before anything is applied."""
    assert client.post(URL, json=body).status_code == 422
    assert not sync_store.records


def test_a_full_batch_is_accepted(client: TestClient) -> None:
    """One hundred operations is within the limit."""
    batch = [
        _op(n, record_id=f"66666666-6666-4666-8666-{n:012d}")
        for n in range(MAX_OPERATIONS_PER_BATCH)
    ]

    results = _send(client, *batch)

    assert [r["status"] for r in results] == ["applied"] * MAX_OPERATIONS_PER_BATCH


def test_operations_need_a_session_and_a_device_signature(
    anonymous: TestClient, session_only: TestClient, sync_store: InMemorySyncStore
) -> None:
    """Neither no credentials nor a bare token can write a record."""
    body = {"operations": [OPERATION]}

    assert anonymous.post(URL, json=body).status_code == 401
    assert session_only.post(URL, json=body).status_code == 401
    assert not sync_store.records
