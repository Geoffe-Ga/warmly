"""Shared fixtures for API tests."""

import pytest
from fastapi.testclient import TestClient

from warmly.app import create_app


@pytest.fixture
def client() -> TestClient:
    """Return a test client bound to a fresh application."""
    return TestClient(create_app())
