"""Per-account and per-device request limits (PRD §8, SEC-005).

These tests run the limiter on in-memory counters. The table that holds the
counters in production is tested in ``tests/db/test_rate_limit_store.py``.
"""

from collections.abc import Generator
from uuid import UUID

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from tests.api.conftest import (
    FakeDatabase,
    InMemoryDeviceStore,
    InMemoryEnrollmentStore,
    InMemoryRecoveryStore,
    InMemoryRequestCounters,
    InMemorySyncStore,
)
from tests.auth.devices import DEVICE_ID, DeviceAuth, TestDevice
from tests.auth.tokens import AUDIENCE, ISSUER, OTHER_OWNER_ID, OWNER_ID, Signer
from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.api.rate_limit import RateLimits, device_scope
from warmly.app import create_app
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier

URL = "/v1/sync/changes"
OTHER_DEVICE = "d0000000-0000-4000-8000-0000000000cc"
# 40 seconds into a minute.
START = 2_000_000_020.0


class _World:
    """An application with small limits, two accounts and a clock to move."""

    def __init__(self, signer: Signer, limits: RateLimits) -> None:
        self.now = START
        self.signer = signer
        self.counters = InMemoryRequestCounters()
        self.devices = InMemoryDeviceStore()
        self.device = TestDevice()
        self.second = TestDevice(device_id=OTHER_DEVICE)
        self.theirs = TestDevice(device_id="d0000000-0000-4000-8000-0000000000dd")
        self.devices.add(OWNER_ID, self.device)
        self.devices.add(OWNER_ID, self.second)
        self.devices.add(OTHER_OWNER_ID, self.theirs)
        self.app = create_app(
            database=FakeDatabase(),
            token_verifier=TokenVerifier(
                issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
            ),
            recovery_store=InMemoryRecoveryStore(),
            device_store=self.devices,
            enrollment_store=InMemoryEnrollmentStore(),
            sync_store=InMemorySyncStore(),
            request_counters=self.counters,
            rate_limits=limits,
            clock=lambda: self.now,
        )

    def client(self, device: TestDevice, owner: str = OWNER_ID) -> TestClient:
        """Return a client signed in as ``owner`` on ``device``."""
        # The token is issued long enough ago and lasts long enough for the
        # moved clock; the signature is stamped with the same clock.
        token = self.signer.token(sub=owner)
        made = TestClient(self.app, headers={"Authorization": f"Bearer {token}"})
        made.auth = _ClockedAuth(device, self)
        return made


class _ClockedAuth(DeviceAuth):
    """Signs with the world's clock, so signatures stay fresh as it moves."""

    def __init__(self, device: TestDevice, world: _World) -> None:
        super().__init__(device)
        self._world = world

    def auth_flow(
        self, request: httpx.Request
    ) -> Generator[httpx.Request, httpx.Response, None]:
        """Add the signature headers, stamped with the world's time."""
        target = request.url.raw_path.decode("ascii")
        request.headers.update(
            self.device.headers(
                request.method,
                target,
                request.content,
                timestamp=int(self._world.now),
            )
        )
        yield request


@pytest.fixture
def world(signer: Signer) -> _World:
    """Return an application allowing 5 requests a minute per account, 3 per device."""
    return _World(signer, RateLimits(per_account=5, per_device=3, window_seconds=60))


def _statuses(client: TestClient, count: int) -> list[int]:
    """Make ``count`` requests and return their statuses."""
    return [client.get(URL).status_code for _ in range(count)]


def test_a_device_is_refused_once_it_has_made_its_requests_for_the_window(
    world: _World,
) -> None:
    """The fourth request in a minute from one device is a 429."""
    client = world.client(world.device)

    assert _statuses(client, 4) == [200, 200, 200, 429]


def test_the_refusal_says_when_to_try_again_and_nothing_else(world: _World) -> None:
    """A problem response with ``Retry-After`` in whole seconds."""
    client = world.client(world.device)
    _statuses(client, 3)
    world.now = START + 15.5

    refused = client.get(URL)

    assert refused.status_code == 429
    assert refused.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert refused.json() == {
        "type": "about:blank",
        "title": "Too Many Requests",
        "status": 429,
        "code": "rate.limited",
        "errors": [],
    }
    # The window began at a whole minute, 40 seconds before START, so it
    # ends 4.5 seconds from now: rounded up to the next whole second.
    assert refused.headers["retry-after"] == "5"


def test_the_allowance_comes_back_when_the_window_ends(world: _World) -> None:
    """A new minute starts the count again."""
    client = world.client(world.device)
    assert _statuses(client, 4)[-1] == 429

    world.now = START + 40.0

    assert _statuses(client, 4) == [200, 200, 200, 429]


def test_another_device_of_the_account_has_its_own_allowance_up_to_the_accounts(
    world: _World,
) -> None:
    """Three from one device, then two from another: the account's five."""
    first, second = world.client(world.device), world.client(world.second)

    assert _statuses(first, 3) == [200, 200, 200]
    assert _statuses(second, 3) == [200, 200, 429]
    # The account is spent, so the second device is refused although it has
    # made fewer requests than a device may.
    assert world.counters.counts[(UUID(OWNER_ID), "account")][1] == 6


def test_one_account_cannot_use_up_anothers_allowance(world: _World) -> None:
    """Counters are per account: a noisy account does not slow another."""
    mine = world.client(world.device)
    theirs = world.client(world.theirs, OTHER_OWNER_ID)
    assert _statuses(mine, 4)[-1] == 429

    assert _statuses(theirs, 3) == [200, 200, 200]


def test_a_request_that_fails_its_signature_still_counts(world: _World) -> None:
    """Guessing uses up the same allowance as real requests."""
    token = world.signer.token()
    stranger = TestClient(world.app, headers={"Authorization": f"Bearer {token}"})
    forged = {
        "Warmly-Device": DEVICE_ID,
        "Warmly-Timestamp": str(int(world.now)),
        "Warmly-Nonce": "n" * 24,
        "Warmly-Signature": "A" * 88,
    }

    statuses = [stranger.get(URL, headers=forged).status_code for _ in range(4)]

    assert statuses == [401, 401, 401, 429]
    # The real device is held up too: the limit bounds the account.
    assert world.client(world.device).get(URL).status_code == 429


def test_a_request_with_no_device_counts_against_the_account_only(
    world: _World,
) -> None:
    """A stolen token alone cannot make more requests than the account may."""
    token = world.signer.token()
    stranger = TestClient(world.app, headers={"Authorization": f"Bearer {token}"})

    statuses = [stranger.get(URL).status_code for _ in range(6)]

    assert statuses == [401, 401, 401, 401, 401, 429]
    assert set(world.counters.counts) == {(UUID(OWNER_ID), "account")}


def test_a_request_with_no_valid_token_is_not_counted(world: _World) -> None:
    """There is no account to count against: the answer is 401 every time."""
    anonymous = TestClient(world.app)

    assert {anonymous.get(URL).status_code for _ in range(10)} == {401}
    assert not world.counters.counts


def test_health_and_readiness_are_never_limited(world: _World) -> None:
    """Monitoring carries no account and is not counted."""
    client = world.client(world.device)
    _statuses(client, 4)

    assert {client.get("/v1/health").status_code for _ in range(10)} == {200}
    assert client.get("/v1/ready").status_code == 200


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/sync/changes"),
        ("POST", "/v1/sync/operations"),
        ("GET", "/v1/devices"),
        ("POST", "/v1/devices"),
        ("GET", "/v1/enrollments/open"),
        ("POST", "/v1/enrollments"),
        ("GET", "/v1/recovery-envelope"),
        ("PUT", "/v1/recovery-envelope"),
    ],
)
def test_every_kind_of_signed_in_route_is_limited(
    world: _World, method: str, path: str
) -> None:
    """Once the allowance is spent, no route answers with anything but 429."""
    client = world.client(world.device)
    _statuses(client, 3)

    refused = client.request(method, path, json={} if method != "GET" else None)

    assert refused.status_code == 429
    assert refused.json()["code"] == "rate.limited"


def test_every_documented_route_but_health_says_it_may_answer_429(
    world: _World,
) -> None:
    """The contract tells clients about the limit wherever it applies."""
    paths = world.app.openapi()["paths"]

    for path, operations in paths.items():
        for operation in operations.values():
            limited = "429" in operation["responses"]
            assert limited is (path not in {"/v1/health", "/v1/ready"}), path


@pytest.mark.parametrize(
    ("header", "scope"),
    [
        (DEVICE_ID, f"device:{DEVICE_ID}"),
        (DEVICE_ID.upper(), f"device:{DEVICE_ID}"),
        (None, None),
        ("", None),
        ("not-a-device", None),
        ("x" * 500, None),
    ],
)
def test_only_a_device_id_names_a_device_counter(
    header: str | None, scope: str | None
) -> None:
    """Anything else counts against the account alone, so it cannot make rows."""
    assert device_scope(header) == scope


def test_the_app_limits_requests_by_default() -> None:
    """Without settings the limits are 600 a minute per account, 300 per device."""
    assert RateLimits() == RateLimits(
        per_account=600, per_device=300, window_seconds=60
    )
