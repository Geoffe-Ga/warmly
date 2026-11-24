"""Every route except health needs a verified token (PRD §8, SEC-006; AC-05)."""

import json
import logging
from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.api.cases import CASES, Case
from tests.api.conftest import FakeDatabase
from tests.auth.tokens import AUDIENCE, ISSUER, OTHER_OWNER_ID, OWNER_ID, Signer
from warmly.api.errors import PROBLEM_MEDIA_TYPE
from warmly.app import create_app
from warmly.auth.dependency import CurrentOwner
from warmly.auth.keys import KeysUnavailableError, StaticKeySource
from warmly.auth.verifier import TokenVerifier
from warmly.config import load_settings
from warmly.logs import LOGGER_NAME
from warmly.schemas.problem import Problem

PUBLIC_PATHS = {"/v1/health", "/v1/ready"}
PRIVATE_CASES = [case for case in CASES if case.path not in PUBLIC_PATHS]
PUBLIC_CASES = [case for case in CASES if case.path in PUBLIC_PATHS]

case_ids = pytest.mark.parametrize(
    "case", PRIVATE_CASES, ids=lambda c: f"{c.method} {c.path}"
)


def _bearer(token: str) -> dict[str, str]:
    """Build the Authorization header for a token."""
    return {"Authorization": f"Bearer {token}"}


def _assert_refused(response: Any, code: str) -> None:
    """Check a response is this API's 401 problem with the given code."""
    assert response.status_code == 401
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json() == {
        "type": "about:blank",
        "title": "Unauthorized",
        "status": 401,
        "code": code,
        "errors": [],
    }
    Problem.model_validate(response.json())


def test_the_private_cases_are_every_route_but_health() -> None:
    """Guards the lists above: nothing private can slip into the public set."""
    assert {case.path for case in PUBLIC_CASES} == PUBLIC_PATHS
    assert len(PRIVATE_CASES) == len(CASES) - len(PUBLIC_PATHS)


@case_ids
def test_a_request_without_a_token_is_refused(
    anonymous: TestClient, case: Case
) -> None:
    """No route but health answers an anonymous caller."""
    response = anonymous.request(case.method, case.path, json=case.body)

    _assert_refused(response, "auth.missing_token")


@pytest.mark.parametrize("case", PUBLIC_CASES, ids=lambda c: c.path)
def test_health_routes_need_no_token(anonymous: TestClient, case: Case) -> None:
    """Health and readiness stay open for load balancers and monitors."""
    assert anonymous.request(case.method, case.path).status_code == 200


@pytest.mark.parametrize(
    "header",
    [
        pytest.param("", id="empty"),
        pytest.param("Bearer", id="scheme only"),
        pytest.param("Basic dXNlcjpwYXNz", id="another scheme"),
        pytest.param("Token abc", id="unknown scheme"),
    ],
)
def test_a_header_that_is_not_a_bearer_token_counts_as_missing(
    anonymous: TestClient, header: str
) -> None:
    """Only ``Bearer <token>`` is a credential."""
    response = anonymous.get("/v1/devices", headers={"Authorization": header})

    _assert_refused(response, "auth.missing_token")


@pytest.mark.parametrize(
    ("claims", "code"),
    [
        pytest.param({"exp": 1}, "auth.invalid_token", id="expired"),
        pytest.param(
            {"iss": "https://evil.example.test/auth/v1"},
            "auth.invalid_token",
            id="wrong issuer",
        ),
        pytest.param({"aud": "other"}, "auth.invalid_token", id="wrong audience"),
        pytest.param(
            {"user_metadata": {"email_verified": False}},
            "auth.email_not_verified",
            id="unverified email",
        ),
    ],
)
def test_an_unacceptable_token_is_refused(
    anonymous: TestClient, signer: Signer, claims: dict[str, Any], code: str
) -> None:
    """Expired, foreign and unverified tokens all get a 401."""
    response = anonymous.get("/v1/devices", headers=_bearer(signer.token(**claims)))

    _assert_refused(response, code)


def test_a_tampered_token_is_refused(anonymous: TestClient, signer: Signer) -> None:
    """A signature from another key is worthless."""
    forged = Signer().token()

    _assert_refused(
        anonymous.get("/v1/devices", headers=_bearer(forged)), "auth.invalid_token"
    )
    _assert_refused(
        anonymous.get("/v1/devices", headers=_bearer(signer.token() + "x")),
        "auth.invalid_token",
    )


@case_ids
def test_a_refusal_happens_before_the_body_is_validated(
    anonymous: TestClient, case: Case
) -> None:
    """An anonymous caller learns nothing about what a valid request looks like."""
    response = anonymous.request(case.method, case.path, json={"nonsense": True})

    _assert_refused(response, "auth.missing_token")


@pytest.fixture
def whoami(app: FastAPI) -> FastAPI:
    """Add a route that reports the owner the request was resolved to."""

    @app.api_route("/test/whoami", methods=["GET", "POST"])
    def read_owner(owner: CurrentOwner) -> dict[str, str]:
        """Report the resolved owner."""
        return {"owner_id": str(owner.id)}

    return app


@pytest.mark.parametrize(
    "request_kwargs",
    [
        pytest.param({"params": {"owner_id": OTHER_OWNER_ID}}, id="query string"),
        pytest.param({"json": {"owner_id": OTHER_OWNER_ID}}, id="request body"),
        pytest.param({"headers": {"X-Owner-Id": OTHER_OWNER_ID}}, id="header"),
        pytest.param({"cookies": {"owner_id": OTHER_OWNER_ID}}, id="cookie"),
    ],
)
def test_the_owner_is_the_token_subject_whatever_the_request_claims(
    whoami: FastAPI, signer: Signer, request_kwargs: dict[str, Any]
) -> None:
    """An owner ID supplied by the client is never used (AC-05)."""
    headers = {**_bearer(signer.token()), **request_kwargs.pop("headers", {})}
    cookies = request_kwargs.pop("cookies", None)
    response = TestClient(whoami, headers=headers, cookies=cookies).post(
        "/test/whoami", **request_kwargs
    )

    assert response.json() == {"owner_id": OWNER_ID}


def test_two_tokens_resolve_to_two_owners(whoami: FastAPI, signer: Signer) -> None:
    """The owner follows the token, not the connection or any cached state."""
    client = TestClient(whoami)

    first = client.get("/test/whoami", headers=_bearer(signer.token()))
    second = client.get(
        "/test/whoami", headers=_bearer(signer.token(sub=OTHER_OWNER_ID))
    )

    assert UUID(first.json()["owner_id"]) == UUID(OWNER_ID)
    assert UUID(second.json()["owner_id"]) == UUID(OTHER_OWNER_ID)


def test_a_given_verifier_is_used_with_a_database_built_from_settings(
    signer: Signer,
) -> None:
    """Supplying only the verifier still gives a working application."""
    verifier = TokenVerifier(
        issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
    )
    app = create_app(load_settings({}), token_verifier=verifier)

    # No lifespan is started, so the database is never contacted.
    response = TestClient(app).get("/v1/devices", headers=_bearer(signer.token()))

    assert response.status_code == 200


def test_the_default_verifier_refuses_a_token_it_cannot_check() -> None:
    """With no provider reachable, the built-in verifier fails closed."""
    settings = load_settings({"WARMLY_AUTH_ISSUER": "http://127.0.0.1:9/auth/v1"})
    app = create_app(settings, database=FakeDatabase())

    response = TestClient(app).get("/v1/devices", headers=_bearer(Signer().token()))

    assert response.status_code == 503
    assert response.json()["code"] == "auth.unavailable"


class _NoKeys:
    """A key source whose provider cannot be reached."""

    async def key_for(self, key_id: str) -> None:
        """Fail as the real source does when nothing is cached."""
        raise KeysUnavailableError


def test_unreachable_signing_keys_are_a_503_not_a_401(signer: Signer) -> None:
    """The client must keep its session when the fault is the server's."""
    verifier = TokenVerifier(issuer=ISSUER, audience=AUDIENCE, keys=_NoKeys())
    app = create_app(token_verifier=verifier, database=FakeDatabase())
    response = TestClient(app).get("/v1/devices", headers=_bearer(signer.token()))

    assert response.status_code == 503
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert "www-authenticate" not in response.headers
    assert response.json()["code"] == "auth.unavailable"


def test_a_refused_token_never_reaches_the_logs(
    anonymous: TestClient, signer: Signer, caplog: pytest.LogCaptureFixture
) -> None:
    """Neither the token nor the reason it failed is logged (SEC-007)."""
    token = signer.token(exp=1)

    with caplog.at_level(logging.DEBUG, logger=LOGGER_NAME):
        anonymous.get("/v1/devices", headers=_bearer(token))

    logged = json.dumps([record.__dict__ for record in caplog.records], default=str)
    assert token not in logged
    assert token.split(".")[1] not in logged
    assert "auth." not in logged


def test_the_contract_documents_the_bearer_scheme_on_private_routes(
    anonymous: TestClient,
) -> None:
    """Clients generated from the contract know which routes need a token."""
    schema = anonymous.get("/v1/openapi.json").json()

    assert schema["components"]["securitySchemes"]["bearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "An access token from the auth provider.",
    }
    for path, item in schema["paths"].items():
        for method, operation in item.items():
            secured = operation.get("security") == [{"bearerAuth": []}]
            assert secured is (path not in PUBLIC_PATHS), (method, path)
            assert ("401" in operation["responses"]) is secured, (method, path)
