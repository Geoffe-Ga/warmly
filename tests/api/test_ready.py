"""Readiness reflects whether the database is usable."""

from fastapi.testclient import TestClient

from tests.api.conftest import FakeDatabase
from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.app import create_app
from warmly.config import Settings
from warmly.middleware.security_headers import SECURITY_HEADERS


def test_ready_names_the_passing_checks(client: TestClient) -> None:
    """A usable database yields 200 with the check listed."""
    response = client.get("/v1/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "checks": {"database": "ok"}}


def test_ready_is_503_when_the_database_is_unusable() -> None:
    """An unusable database yields a 503 problem with no detail about why."""
    response = TestClient(create_app(database=FakeDatabase(ready=False))).get(
        "/v1/ready"
    )

    assert response.status_code == 503
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json() == {
        "type": "about:blank",
        "title": "Service not ready",
        "status": 503,
        "code": "service.not_ready",
        "errors": [],
    }
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


def test_health_stays_ok_when_the_database_is_down() -> None:
    """Liveness is about the process, not its dependencies."""
    client = TestClient(create_app(database=FakeDatabase(ready=False)))

    assert client.get("/v1/health").status_code == 200


def test_the_pool_is_opened_and_closed_with_the_application() -> None:
    """The lifespan owns the connection pool."""
    database = FakeDatabase()

    with TestClient(create_app(database=database)) as client:
        assert database.events == ["open"]
        assert client.get("/v1/ready").status_code == 200

    assert database.events == ["open", "close"]


def test_an_unreachable_database_does_not_stop_the_api_from_starting() -> None:
    """The real pool opens in the background; readiness then reports 503."""
    settings = Settings(
        environment="test",
        # Port 9 (discard) on loopback: nothing is listening there.
        database_url="postgresql://nobody@127.0.0.1:9/none?connect_timeout=1",
    )

    with TestClient(create_app(settings)) as client:
        assert client.get("/v1/health").status_code == 200
        assert client.get("/v1/ready").status_code == 503
