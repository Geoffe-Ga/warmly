"""Shared fixtures for API tests."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.auth.tokens import AUDIENCE, ISSUER, OWNER_ID, Signer
from warmly.app import create_app
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier
from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope


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

    @asynccontextmanager
    async def as_owner(self, owner_id: UUID) -> AsyncIterator[Any]:
        """Refuse: a test that reaches storage must supply its own store."""
        msg = f"FakeDatabase has no tables (transaction asked for by {owner_id})"
        raise AssertionError(msg)
        yield


class InMemoryRecoveryStore:
    """Recovery envelopes kept in a dictionary, with the real version rules.

    The table's behaviour is tested against PostgreSQL in
    ``tests/db/test_recovery_store.py``. This double lets the route tests run
    without a database.
    """

    def __init__(self) -> None:
        """Start with no envelopes."""
        self.envelopes: dict[UUID, RecoveryEnvelope] = {}

    async def read(self, owner_id: UUID) -> RecoveryEnvelope | None:
        """Return the owner's envelope, if any."""
        return self.envelopes.get(owner_id)

    async def write(
        self, owner_id: UUID, request: PutRecoveryEnvelopeRequest
    ) -> RecoveryEnvelope | None:
        """Create or replace with compare-and-swap, as the table does."""
        current = self.envelopes.get(owner_id)
        if (current.version if current else 0) != request.expected_version:
            return None
        self.envelopes[owner_id] = RecoveryEnvelope(
            version=request.expected_version + 1,
            format_version=request.format_version,
            wrapped_key=request.wrapped_key,
        )
        return self.envelopes[owner_id]


@pytest.fixture(scope="session")
def signer() -> Signer:
    """Return the key pair the test application trusts."""
    return Signer()


@pytest.fixture
def recovery_store() -> InMemoryRecoveryStore:
    """Return a store in which the test owner already has an envelope.

    Tests about an account without one clear ``envelopes`` first.
    """
    store = InMemoryRecoveryStore()
    store.envelopes[UUID(OWNER_ID)] = RecoveryEnvelope(
        version=1, format_version=1, wrapped_key="c2VlZGVk"
    )
    return store


@pytest.fixture
def app(signer: Signer, recovery_store: InMemoryRecoveryStore) -> FastAPI:
    """Return a fresh application with a ready database and a local key."""
    verifier = TokenVerifier(
        issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
    )
    return create_app(
        database=FakeDatabase(),
        token_verifier=verifier,
        recovery_store=recovery_store,
    )


@pytest.fixture
def anonymous(app: FastAPI) -> TestClient:
    """Return a client that sends no credentials."""
    return TestClient(app)


@pytest.fixture
def client(app: FastAPI, signer: Signer) -> TestClient:
    """Return a client signed in as the test owner."""
    return TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})
