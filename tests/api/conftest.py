"""Shared fixtures for API tests."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.auth.tokens import AUDIENCE, ISSUER, Signer
from warmly.app import create_app
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier


class FakeDatabase:
    """A database handle that connects to nothing and records its lifecycle."""

    def __init__(self, *, ready: bool = True) -> None:
        """Create the double.

        Args:
            ready: What ``ping`` should report.
        """
        self.ready = ready
        self.events: list[str] = []

    async def open(self) -> None:
        """Record that the pool was opened."""
        self.events.append("open")

    async def close(self) -> None:
        """Record that the pool was closed."""
        self.events.append("close")

    async def ping(self) -> bool:
        """Report the configured readiness."""
        return self.ready


@pytest.fixture(scope="session")
def signer() -> Signer:
    """Return the key pair the test application trusts."""
    return Signer()


@pytest.fixture
def app(signer: Signer) -> FastAPI:
    """Return a fresh application with a ready database and a local key."""
    verifier = TokenVerifier(
        issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
    )
    return create_app(database=FakeDatabase(), token_verifier=verifier)


@pytest.fixture
def anonymous(app: FastAPI) -> TestClient:
    """Return a client that sends no credentials."""
    return TestClient(app)


@pytest.fixture
def client(app: FastAPI, signer: Signer) -> TestClient:
    """Return a client signed in as the test owner."""
    return TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})
