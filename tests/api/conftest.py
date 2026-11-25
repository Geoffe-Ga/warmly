"""Shared fixtures for API tests."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.auth.devices import (
    ENROLLMENT_VERIFIER,
    NAME_CIPHERTEXT,
    DeviceAuth,
    TestDevice,
)
from tests.auth.tokens import AUDIENCE, ISSUER, OWNER_ID, Signer
from warmly.app import create_app
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier
from warmly.schemas.devices import Device, RegisterDeviceRequest
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
        self.verifiers: dict[UUID, str] = {}

    async def enrollment_verifier(self, owner_id: UUID) -> str | None:
        """Return the verifier stored when the envelope was created."""
        return self.verifiers.get(owner_id)

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
        if request.device_enrollment_verifier is not None:
            self.verifiers[owner_id] = request.device_enrollment_verifier
        return self.envelopes[owner_id]


@dataclass
class _StoredDevice:
    """A device as the in-memory store keeps it."""

    owner_id: UUID
    device: Device
    revoked: bool = False

    @property
    def public_key(self) -> str:
        """Return the registered public key."""
        return self.device.public_key


class InMemoryDeviceStore:
    """Devices and nonces kept in dictionaries, with the real ownership rules.

    The tables' behaviour is tested against PostgreSQL in
    ``tests/db/test_device_store.py``.
    """

    def __init__(self) -> None:
        """Start with no devices."""
        self.devices: dict[UUID, _StoredDevice] = {}
        self.nonces: set[tuple[UUID, str]] = set()

    def _own(self, owner_id: UUID, device_id: UUID) -> _StoredDevice | None:
        """Return the device only if it belongs to the owner."""
        stored = self.devices.get(device_id)
        return stored if stored and stored.owner_id == owner_id else None

    async def find(self, owner_id: UUID, device_id: UUID) -> _StoredDevice | None:
        """Return the owner's device with this ID, or ``None``."""
        return self._own(owner_id, device_id)

    async def use_nonce(
        self, owner_id: UUID, device_id: UUID, nonce: str, expires_at: datetime
    ) -> bool:
        """Record a nonce; ``False`` if it was already used."""
        key = (device_id, nonce)
        if key in self.nonces:
            return False
        self.nonces.add(key)
        return True

    async def list(self, owner_id: UUID, current: UUID) -> list[Device]:
        """Return the owner's devices in registration order."""
        return [
            stored.device.model_copy(update={"is_current": device_id == current})
            for device_id, stored in self.devices.items()
            if stored.owner_id == owner_id
        ]

    async def register(
        self, owner_id: UUID, request: RegisterDeviceRequest
    ) -> Device | None:
        """Add a device; ``None`` if the ID is taken by any account."""
        if request.device_id in self.devices:
            return None
        device = Device(
            id=request.device_id,
            name_ciphertext=request.name_ciphertext,
            public_key=request.public_key,
            created_at=datetime(2026, 11, 25, tzinfo=UTC),
            is_current=True,
        )
        self.devices[request.device_id] = _StoredDevice(owner_id, device)
        return device

    async def rename(
        self, owner_id: UUID, device_id: UUID, name_ciphertext: str, current: UUID
    ) -> Device | None:
        """Replace a device's encrypted name; ``None`` if it is not the owner's."""
        stored = self._own(owner_id, device_id)
        if stored is None:
            return None
        stored.device = stored.device.model_copy(
            update={"name_ciphertext": name_ciphertext}
        )
        return stored.device.model_copy(update={"is_current": device_id == current})

    def add(self, owner_id: str, device: TestDevice) -> None:
        """Register a test device directly, bypassing the route."""
        self.devices[UUID(device.device_id)] = _StoredDevice(
            UUID(owner_id),
            Device(
                id=UUID(device.device_id),
                name_ciphertext=NAME_CIPHERTEXT,
                public_key=device.public_key,
                created_at=datetime(2026, 11, 25, tzinfo=UTC),
                is_current=False,
            ),
        )


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
    store.verifiers[UUID(OWNER_ID)] = ENROLLMENT_VERIFIER
    return store


@pytest.fixture(scope="session")
def device() -> TestDevice:
    """Return the test owner's registered device."""
    return TestDevice()


@pytest.fixture
def device_store(device: TestDevice) -> InMemoryDeviceStore:
    """Return a store in which the test owner has one registered device."""
    store = InMemoryDeviceStore()
    store.add(OWNER_ID, device)
    return store


@pytest.fixture
def app(
    signer: Signer,
    recovery_store: InMemoryRecoveryStore,
    device_store: InMemoryDeviceStore,
) -> FastAPI:
    """Return a fresh application with a ready database and a local key."""
    verifier = TokenVerifier(
        issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
    )
    return create_app(
        database=FakeDatabase(),
        token_verifier=verifier,
        recovery_store=recovery_store,
        device_store=device_store,
    )


@pytest.fixture
def anonymous(app: FastAPI) -> TestClient:
    """Return a client that sends no credentials."""
    return TestClient(app)


@pytest.fixture
def session_only(app: FastAPI, signer: Signer) -> TestClient:
    """Return a client with a valid session token that signs nothing.

    This is what someone holding a stolen token could send.
    """
    return TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})


@pytest.fixture
def client(app: FastAPI, signer: Signer, device: TestDevice) -> TestClient:
    """Return a client signed in as the test owner on their registered device."""
    signed = TestClient(app, headers={"Authorization": f"Bearer {signer.token()}"})
    signed.auth = DeviceAuth(device)
    return signed
