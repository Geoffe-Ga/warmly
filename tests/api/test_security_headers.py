"""Every API response carries the security headers, including errors."""

import pytest
from fastapi.testclient import TestClient

from tests.api.cases import CASES, Case
from warmly.middleware.security_headers import SECURITY_HEADERS


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.method} {c.path}")
def test_success_responses_carry_every_security_header(
    client: TestClient, case: Case
) -> None:
    """Each route sends the full header set."""
    response = client.request(case.method, case.path, json=case.body)

    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [
        ("GET", "/v1/nope", 404),
        ("DELETE", "/v1/health", 405),
        ("PUT", "/v1/recovery-envelope", 422),
    ],
)
def test_error_responses_carry_every_security_header(
    client: TestClient, method: str, path: str, status: int
) -> None:
    """Errors are responses too."""
    response = client.request(method, path)

    assert response.status_code == status
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


def test_policy_forbids_everything_and_responses_are_never_cached() -> None:
    """The API serves JSON only: nothing may load, frame or cache it."""
    assert SECURITY_HEADERS["Content-Security-Policy"] == (
        "default-src 'none'; frame-ancestors 'none'"
    )
    assert SECURITY_HEADERS["Cache-Control"] == "no-store"
    assert SECURITY_HEADERS["X-Content-Type-Options"] == "nosniff"
