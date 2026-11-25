"""Every route against every attack, on a real database (SEC-005, SEC-006).

Account B attacks account A. Whatever B sends, three things must hold:

1. Nothing of A's appears in any answer B gets.
2. Nothing of A's changes, in any table.
3. Where a request names A's data, the answer is the same as for data that
   does not exist, so B cannot even tell that A's data is there.

PRD SEC-005, SEC-006, SYNC-007; AC-04, AC-05, AC-20.
"""

import json
import time
from collections.abc import Callable
from typing import Any

import pytest
from httpx2 import Response

from tests.auth.devices import TestDevice
from tests.security.matrix import (
    ATTACKS,
    CASES,
    KNOWN_DIFFERENCES,
    OPERATIONS,
    PUBLIC,
    Attack,
    Operation,
)
from tests.security.world import Account, Ids, World

pytestmark = pytest.mark.integration

Run = Callable[[World, Operation], list[Response]]

# Response fields that differ between any two requests, whoever makes them.
FRESH_FIELDS = frozenset({"id", "challenge", "expires_at", "created_at", "public_key"})

# Field names a careless API might read an owner from.
OWNER_FIELDS = ("owner_id", "account_id", "user_id", "sub")
OWNER_HEADERS = ("X-Owner-Id", "X-User-Id", "Warmly-Owner", "X-Forwarded-User")


def _send(
    world: World,
    actor: Account,
    operation: Operation,
    ids: Ids,
    **changes: Any,
) -> Response:
    """Send a route's request as an account, signed if the route needs it."""
    path, body = operation.request(ids)
    signer = actor.device if operation.signed else None
    if operation.self_signed:
        # A new device, enrolling itself under the ID the request names,
        # with a correct proof for the account's key.
        signer = TestDevice(device_id=ids.device_id)
        body = signer.registration()
    options: dict[str, Any] = {"token": actor.token, "body": body, "signed_by": signer}
    path = changes.pop("path", path)
    return world.send(operation.method, path, **(options | changes))


def _same_answer(theirs: Response, nobodys: Response, used: tuple[Ids, Ids]) -> None:
    """Check two answers differ in nothing but the identifiers that were sent."""

    def plain(response: Response, ids: Ids) -> tuple[int, str]:
        text = response.text
        for value in (ids.device_id, ids.enrollment_id, ids.record_id):
            text = text.replace(value, "<id>")
        try:
            body = json.loads(text)
        except json.JSONDecodeError:
            return response.status_code, text
        if isinstance(body, dict):
            # Made afresh by the server or the client on every request.
            for result in body.get("results", []):
                result["op_id"] = "<op>"
            for fresh in FRESH_FIELDS & set(body):
                body[fresh] = f"<{fresh}>"
        return response.status_code, json.dumps(body, sort_keys=True)

    assert plain(theirs, used[0]) == plain(nobodys, used[1])


def _foreign_ids(world: World, operation: Operation) -> list[Response]:
    theirs = _send(world, world.b, operation, world.a.ids)
    unknown = Ids.unknown()
    nobodys = _send(world, world.b, operation, unknown)
    if operation.key in KNOWN_DIFFERENCES:
        # The one documented difference: the ID is taken, whoever has it.
        assert (theirs.status_code, nobodys.status_code) == (409, 201)
        assert theirs.json()["code"] == "device.already_registered"
    else:
        _same_answer(theirs, nobodys, (world.a.ids, unknown))
    return [theirs, nobodys]


def _owner_fields(world: World, operation: Operation) -> list[Response]:
    path, body = operation.request(world.b.ids)
    target = world.a.owner_id
    query = "&".join(f"{name}={target}" for name in OWNER_FIELDS)
    in_query = _send(world, world.b, operation, world.b.ids, path=f"{path}?{query}")
    in_headers = _send(
        world,
        world.b,
        operation,
        world.b.ids,
        headers=dict.fromkeys(OWNER_HEADERS, target),
    )
    answers = [in_query, in_headers]
    if body is not None:
        in_body = _send(
            world,
            world.b,
            operation,
            world.b.ids,
            body=body | dict.fromkeys(OWNER_FIELDS, target),
        )
        # A body may only carry the fields the contract names.
        assert in_body.status_code == 422, in_body.text
        answers.append(in_body)
    return answers


def _expired_token(world: World, operation: Operation) -> list[Response]:
    past = int(time.time()) - 7200
    stale = world.signer.token(sub=world.b.owner_id, iat=past, exp=past + 3600)
    answer = _send(world, world.b, operation, world.a.ids, token=stale)
    assert answer.status_code == 401, answer.text
    assert answer.json()["code"].startswith("auth.")
    return [answer]


def _unsigned(world: World, operation: Operation) -> list[Response]:
    answer = _send(world, world.b, operation, world.a.ids, signed_by=None)
    assert answer.status_code == 401, answer.text
    assert answer.json()["code"] == "device.missing_signature"
    return [answer]


def _replayed(world: World, operation: Operation) -> list[Response]:
    nonce = "replayed-nonce-0123456789"
    # B's own data, naming the spare device so that a route which removes a
    # device does not remove the one that is signing.
    own = Ids(world.b.spare.device_id, world.b.ids.enrollment_id, world.b.ids.record_id)
    first = _send(world, world.b, operation, own, nonce=nonce)
    again = _send(world, world.b, operation, own, nonce=nonce)
    assert first.status_code != 401, first.text
    assert again.status_code == 401, again.text
    assert again.json()["code"] == "device.not_authorized"
    return [first, again]


def _revoked(world: World, operation: Operation) -> list[Response]:
    removed = world.send(
        "POST",
        f"/v1/devices/{world.b.spare.device_id}/revoke",
        token=world.b.token,
        signed_by=world.b.device,
    )
    assert removed.status_code == 200, removed.text
    answer = _send(world, world.b, operation, world.a.ids, signed_by=world.b.spare)
    assert answer.status_code == 401, answer.text
    assert answer.json()["code"] == "device.revoked"
    return [answer]


def _borrowed_device(world: World, operation: Operation) -> list[Response]:
    # A's real device, signing correctly, under B's token.
    theirs = _send(world, world.b, operation, world.a.ids, signed_by=world.a.device)
    # A device nobody has registered.
    nobodys = _send(world, world.b, operation, world.a.ids, signed_by=TestDevice())
    assert theirs.status_code == 401, theirs.text
    assert theirs.json() == nobodys.json()
    assert theirs.json()["code"] == "device.not_authorized"
    return [theirs, nobodys]


RUNS: dict[str, Run] = {
    "another account's identifiers": _foreign_ids,
    "an owner field in the query, a header and the body": _owner_fields,
    "an expired session token": _expired_token,
    "no device signature": _unsigned,
    "a replayed request": _replayed,
    "a revoked device": _revoked,
    "another account's device": _borrowed_device,
}


@pytest.mark.parametrize(
    ("operation", "attack"),
    CASES,
    ids=[f"{operation} <- {attack.name}" for operation, attack in CASES],
)
def test_an_attack_on_a_route_reveals_nothing_and_changes_nothing(
    world: World, operation: Operation, attack: Attack
) -> None:
    """B attacks A through one route in one way (SEC-006, AC-05)."""
    before = world.snapshot(world.a)

    answers = RUNS[attack.name](world, operation)

    for answer in answers:
        assert not learned(answer, world.a), (str(operation), attack.name)
    assert world.snapshot(world.a) == before


def learned(answer: Response, target: Account) -> list[str]:
    """Return what an answer told its sender about the target account.

    Anything the sender put in the request themselves is not counted: an
    identifier echoed back teaches them nothing.

    Args:
        answer: The response, with the request that produced it.
        target: The account under attack.

    Returns:
        The target's secrets found in the response's body or headers.
    """
    request = answer.request
    sent = f"{request.url} {request.content.decode()}"
    received = answer.text + " ".join(
        f"{name}: {value}" for name, value in answer.headers.items()
    )
    return [
        secret for secret in target.secrets if secret in received and secret not in sent
    ]


def test_every_route_in_the_contract_is_in_the_matrix(world: World) -> None:
    """A new route with no row here fails, so none ships unattacked."""
    paths = world.client.get("/v1/openapi.json").json()["paths"]
    documented = {
        (method.upper(), path) for path, item in paths.items() for method in item
    }

    assert {operation.key for operation in OPERATIONS} == documented - PUBLIC


def test_every_attack_has_a_way_to_run_and_every_route_meets_one() -> None:
    """The table and the code that carries it out cannot drift apart."""
    assert set(RUNS) == {attack.name for attack in ATTACKS}
    assert {operation for operation, _ in CASES} == set(OPERATIONS)
    # Every route is tried with an expired token and with injected owner
    # fields, whether or not it needs a device.
    for operation in OPERATIONS:
        tried = {attack.name for each, attack in CASES if each == operation}
        assert {
            "an expired session token",
            "an owner field in the query, a header and the body",
        } <= tried


def test_which_routes_need_no_device_is_what_the_application_says(
    world: World,
) -> None:
    """The matrix's idea of a signed route matches how the API behaves."""
    for operation in OPERATIONS:
        answer = _send(world, world.b, operation, world.b.ids, signed_by=None)
        refused = (
            answer.status_code == 401
            and answer.json()["code"] == "device.missing_signature"
        )
        assert refused is (operation.signed or operation.self_signed), str(operation)


def test_the_public_routes_say_nothing_about_any_account(world: World) -> None:
    """Health and readiness are the same for everyone and carry no account."""
    for _method, path in sorted(PUBLIC):
        anonymous = world.client.get(path)
        signed_in = world.send("GET", path, token=world.a.token)

        assert anonymous.status_code == 200
        assert anonymous.json() == signed_in.json()
        assert not learned(anonymous, world.a)
        assert not learned(signed_in, world.b)


def test_an_account_reads_its_own_data_and_only_its_own(world: World) -> None:
    """The control: the same requests, made honestly, do return data."""
    feed = world.send(
        "GET", "/v1/sync/changes", token=world.b.token, signed_by=world.b.device
    ).json()
    devices = world.send(
        "GET", "/v1/devices", token=world.b.token, signed_by=world.b.device
    ).text
    envelope = world.send("GET", "/v1/recovery-envelope", token=world.b.token).json()

    assert [change["record_id"] for change in feed["changes"]] == [
        world.b.ids.record_id
    ]
    assert feed["changes"][0]["payload"] == world.b.payload
    assert world.b.ids.device_id in devices
    assert envelope["wrapped_key"] == world.b.wrapped_key
    for secret in world.a.secrets:
        assert secret not in json.dumps(feed) + devices + json.dumps(envelope)
