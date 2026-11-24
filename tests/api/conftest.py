"""Shared fixtures for API tests."""

import pytest
from fastapi.testclient import TestClient

from warmly.app import create_app


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


@pytest.fixture
def client() -> TestClient:
    """Return a test client bound to a fresh application with a ready database."""
    return TestClient(create_app(database=FakeDatabase()))
