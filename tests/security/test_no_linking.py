"""No route links two accounts, and no log line names one (AC-27, SEC-007).

Accounts are independent: there is no partner, no sharing and no invitation
(PRD §0, invariant 4). These tests look for any way the API could connect
two accounts, and check that what one account does is invisible to another.
"""

import json
import logging
import re
from typing import Any

import pytest

from tests.security.matrix import OPERATIONS, PUBLIC
from tests.security.world import Account, World
from warmly.logs import LOGGER_NAME, REQUEST_LOG_FIELDS

pytestmark = pytest.mark.integration

# Words that would name another person, or a relationship between accounts.
LINKING_WORDS = re.compile(
    r"owner|account|user|partner|share|invit|link|email|friend|contact|member"
    r"|team|group|recipient|follow|couple|spouse",
    re.IGNORECASE,
)


def _names(node: Any) -> list[str]:
    """Collect every property and parameter name in a part of the contract."""
    found: list[str] = []
    if isinstance(node, dict):
        found += [str(name) for name in node.get("properties", {})]
        if "name" in node and "in" in node:
            found.append(str(node["name"]))
        for value in node.values():
            found += _names(value)
    elif isinstance(node, list):
        for value in node:
            found += _names(value)
    return found


def _views(world: World, account: Account) -> dict[str, Any]:
    """Return everything an account can read about itself."""

    def signed(path: str) -> Any:
        return world.send(
            "GET", path, token=account.token, signed_by=account.device
        ).json()

    return {
        "changes": signed("/v1/sync/changes"),
        "devices": signed("/v1/devices"),
        "open": signed("/v1/enrollments/open"),
        "request": world.send(
            "GET", f"/v1/enrollments/{account.ids.enrollment_id}", token=account.token
        ).json(),
        "envelope": world.send(
            "GET", "/v1/recovery-envelope", token=account.token
        ).json(),
    }


def test_no_request_can_carry_another_persons_identity(world: World) -> None:
    """Nothing in the contract takes an owner, a partner, an email or a share."""
    contract = world.client.get("/v1/openapi.json").json()
    request_side = [
        operation.get("parameters", [])
        for item in contract["paths"].values()
        for operation in item.values()
    ]
    bodies = [
        schema
        for name, schema in contract["components"]["schemas"].items()
        if name.endswith("Request") or name == "SyncOperation"
    ]

    suspicious = [
        name
        for name in _names(request_side) + _names(bodies)
        if LINKING_WORDS.search(name)
    ]

    assert not suspicious


def test_no_route_is_about_another_person(world: World) -> None:
    """No path or tag suggests sharing, inviting or linking."""
    contract = world.client.get("/v1/openapi.json").json()

    for path, item in contract["paths"].items():
        assert not LINKING_WORDS.search(path), path
        for operation in item.values():
            for tag in operation.get("tags", []):
                assert not LINKING_WORDS.search(tag), tag


def test_no_response_names_an_account(world: World) -> None:
    """Responses never carry an owner ID, even the caller's own."""
    for account in (world.a, world.b):
        seen = json.dumps(_views(world, account))

        assert account.owner_id not in seen
        assert "owner" not in seen.lower()


def test_nothing_one_account_does_is_visible_to_another(world: World) -> None:
    """A's view of its own data is the same whatever B does, honestly (AC-27).

    B makes every kind of request the API has, about its own data. If any
    route wrote somewhere A could read, A's view would change.
    """
    before = _views(world, world.a)

    for operation in OPERATIONS:
        path, body = operation.request(world.b.ids)
        world.send(
            operation.method,
            path,
            token=world.b.token,
            body=body,
            signed_by=world.b.device if operation.signed else None,
        )

    after = _views(world, world.a)
    # Reading the feed to its end records when the device last synced.
    for view in (before, after):
        for device in view["devices"]["devices"]:
            device.pop("last_sync_at")
    assert after == before


def test_the_logs_name_no_account_device_or_record(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    """A log line carries the closed field set and nothing else (SEC-007)."""
    caplog.set_level(logging.INFO, logger=LOGGER_NAME)
    logging.getLogger(LOGGER_NAME).addHandler(caplog.handler)
    try:
        for operation in OPERATIONS:
            for ids in (world.b.ids, world.a.ids):
                path, body = operation.request(ids)
                world.send(
                    operation.method,
                    f"{path}?owner_id={world.a.owner_id}",
                    token=world.b.token,
                    body=body,
                    signed_by=world.b.device if operation.signed else None,
                )
        for _method, path in sorted(PUBLIC):
            world.client.get(path)
    finally:
        logging.getLogger(LOGGER_NAME).removeHandler(caplog.handler)

    written = [
        json.dumps(getattr(record, "fields", {})) + record.getMessage()
        for record in caplog.records
    ]
    assert len(written) >= 2 * len(OPERATIONS)
    for record in caplog.records:
        assert set(getattr(record, "fields", {})) <= REQUEST_LOG_FIELDS
    for line in written:
        for secret in (
            *world.a.secrets,
            *world.b.secrets,
            world.a.token,
            world.b.token,
        ):
            assert secret not in line
