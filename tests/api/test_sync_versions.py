"""Old and new clients at the same time (PRD §8, REL-004; AC-28; D-20).

Every sync request says which sync protocol version the client speaks. A
version the server does not speak is refused with 426 before anything is
read or written, and the answer says which versions are spoken.
"""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from tests.api.cases import OPERATION
from tests.api.conftest import (
    FakeDatabase,
    InMemoryDeviceStore,
    InMemoryEnrollmentStore,
    InMemoryRecoveryStore,
    InMemoryRequestCounters,
    InMemorySyncStore,
)
from tests.auth.devices import TestDevice
from tests.auth.tokens import AUDIENCE, ISSUER, Signer
from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.app import create_app
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier
from warmly.schemas.sync import SYNC_VERSION_MAX, SYNC_VERSION_MIN

CHANGES = "/v1/sync/changes"
OPERATIONS = "/v1/sync/operations"
HEADER = "Warmly-Sync-Version"


def _ask(
    session_only: TestClient,
    device: TestDevice,
    version: str | None,
    *,
    method: str = "GET",
    path: str = CHANGES,
    body: dict[str, Any] | None = None,
) -> Response:
    """Send a correctly signed request that states ``version``, or none."""
    content = b"" if body is None else json.dumps(body).encode()
    headers = device.headers(method, path, content)
    del headers[HEADER]
    if version is not None:
        headers[HEADER] = version
    if body is not None:
        headers["Content-Type"] = "application/json"
    return session_only.request(method, path, content=content, headers=headers)


def _refused(response: Response, oldest: int, newest: int) -> None:
    """Check a response is the upgrade refusal, naming the versions spoken."""
    assert response.status_code == 426, response.text
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json() == {
        "type": "about:blank",
        "title": "Upgrade Required",
        "status": 426,
        "code": "sync.upgrade_required",
        "errors": [],
    }
    assert response.headers["warmly-sync-min"] == str(oldest)
    assert response.headers["warmly-sync-max"] == str(newest)


def test_the_server_speaks_version_one_only_for_now() -> None:
    """There is one sync version; the window exists for the day there are two."""
    assert (SYNC_VERSION_MIN, SYNC_VERSION_MAX) == (1, 1)


def test_a_client_that_speaks_a_supported_version_syncs(
    session_only: TestClient, device: TestDevice
) -> None:
    """The current client is served as before."""
    response = _ask(session_only, device, "1")

    assert response.status_code == 200
    assert "warmly-sync-min" not in response.headers


@pytest.mark.parametrize(
    "version",
    [
        None,
        "0",
        "2",
        "999",
        "",
        "abc",
        "1.0",
        "-1",
        " 1",
        "1 ",
        "+1",
        "0x1",
        "1\n",
        "0000000001",
        "9" * 5000,
    ],
    ids=lambda version: repr(version)[:16],
)
def test_a_client_that_speaks_no_supported_version_is_told_to_update(
    session_only: TestClient, device: TestDevice, version: str | None
) -> None:
    """Too old, too new, not a number or not stated: all refused the same way."""
    _refused(_ask(session_only, device, version), 1, 1)


def test_a_refused_client_changes_nothing(
    session_only: TestClient, device: TestDevice, sync_store: InMemorySyncStore
) -> None:
    """Nothing is applied, so the client's queued changes are still its own."""
    response = _ask(
        session_only,
        device,
        "0",
        method="POST",
        path=OPERATIONS,
        body={"operations": [OPERATION]},
    )

    _refused(response, 1, 1)
    assert not sync_store.records
    assert not sync_store.receipts


def test_the_version_is_checked_before_the_request_itself(
    session_only: TestClient, device: TestDevice
) -> None:
    """An old client's request may not even be well formed any more."""
    malformed = _ask(
        session_only,
        device,
        "0",
        method="POST",
        path=OPERATIONS,
        body={"operations": "not a list"},
    )
    bad_cursor = _ask(session_only, device, "0", path=f"{CHANGES}?cursor=abc")

    _refused(malformed, 1, 1)
    _refused(bad_cursor, 1, 1)


def test_only_a_caller_allowed_to_sync_is_told_the_versions(
    anonymous: TestClient, session_only: TestClient
) -> None:
    """Without a session and a device the answer is 401, whatever is stated."""
    for stranger in (anonymous, session_only):
        response = stranger.get(CHANGES, headers={HEADER: "0"})

        assert response.status_code == 401
        assert "warmly-sync-min" not in response.headers


def test_routes_other_than_sync_do_not_ask_for_a_version(
    session_only: TestClient, device: TestDevice
) -> None:
    """Managing devices and keys must keep working for a client that is behind."""
    listed = _ask(session_only, device, None, path="/v1/devices")
    envelope = session_only.get("/v1/recovery-envelope")

    assert listed.status_code == 200
    assert envelope.status_code == 200


def test_a_server_that_has_moved_on_refuses_the_old_version_and_serves_the_new(
    signer: Signer, device: TestDevice, device_store: InMemoryDeviceStore
) -> None:
    """A test-only window stands in for a server that speaks versions 2 and 3."""
    app = create_app(
        database=FakeDatabase(),
        token_verifier=TokenVerifier(
            issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
        ),
        recovery_store=InMemoryRecoveryStore(),
        device_store=device_store,
        enrollment_store=InMemoryEnrollmentStore(),
        sync_store=InMemorySyncStore(),
        request_counters=InMemoryRequestCounters(),
        sync_versions=(2, 3),
    )
    newer = TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})

    _refused(_ask(newer, device, "1"), 2, 3)
    _refused(_ask(newer, device, "4"), 2, 3)
    assert _ask(newer, device, "2").status_code == 200
    assert _ask(newer, device, "3").status_code == 200


def test_the_contract_documents_the_version_on_the_sync_routes_only(
    client: TestClient,
) -> None:
    """Clients learn about the header and the refusal from the contract."""
    paths = client.get("/v1/openapi.json").json()["paths"]

    for path, operations in paths.items():
        for operation in operations.values():
            names = {parameter["name"] for parameter in operation.get("parameters", [])}
            sync = path.startswith("/v1/sync/")
            assert (HEADER in names) is sync, path
            assert ("426" in operation["responses"]) is sync, path
