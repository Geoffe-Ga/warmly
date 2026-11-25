"""Two real accounts on a real database, for the adversarial suite.

Nothing here is a double: the application is built with its PostgreSQL
stores, and both accounts are set up through the API itself.
"""

from collections.abc import Iterator

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.auth.tokens import AUDIENCE, ISSUER, Signer
from tests.db.conftest import (
    admin_url,
    database_url,
    empty_database_url,
    throwaway_database,
)
from tests.security.world import World, owned_tables
from warmly.api.rate_limit import RateLimits
from warmly.app import create_app
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import TokenVerifier
from warmly.db.database import Database

# The database fixtures are shared with the storage tests.
__all__ = ["admin_url", "database_url", "empty_database_url", "throwaway_database"]


@pytest.fixture(scope="session")
def signer() -> Signer:
    """Return the key pair the test application trusts."""
    return Signer()


@pytest.fixture
def world(database_url: str, signer: Signer) -> Iterator[World]:
    """Return an application on an empty database, with accounts A and B set up."""
    with psycopg.connect(database_url) as conn:
        tables = owned_tables(conn)
        conn.execute(
            "TRUNCATE "
            + ", ".join(f"warmly_private.{table}" for table in tables)
            + " CASCADE"
        )
    app = create_app(
        database=Database(database_url),
        token_verifier=TokenVerifier(
            issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
        ),
        # Generous, so that only the rate-limit tests ever meet the limit.
        rate_limits=RateLimits(per_account=100_000, per_device=100_000),
    )
    with TestClient(app) as client:
        yield World.build(client, signer, database_url)
