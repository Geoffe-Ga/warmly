"""The recovery envelope table (PRD SEC-003, SEC-006; AC-05, AC-18).

Run against a real PostgreSQL, because the guarantees here are the database's:
compare-and-swap in one statement, and row-level security between accounts.
"""

import asyncio
from collections.abc import AsyncIterator
from uuid import UUID

import psycopg
import pytest
import pytest_asyncio

from tests.auth.devices import ENROLLMENT_KEY
from tests.db.conftest import BROWSER_ROLES
from warmly.db.database import Database
from warmly.db.recovery_store import PostgresRecoveryStore
from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
WRAPPED_A = "QUFBQQ=="
WRAPPED_B = "QkJCQg=="
TABLE = "warmly_private.recovery_envelopes"


def _request(expected: int, wrapped: str = WRAPPED_A) -> PutRecoveryEnvelopeRequest:
    """Build a write request."""
    return PutRecoveryEnvelopeRequest(
        expected_version=expected,
        format_version=1,
        wrapped_key=wrapped,
        device_enrollment_key=ENROLLMENT_KEY if expected == 0 else None,
    )


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database and empty the table."""
    database = Database(database_url, max_size=4)
    await database.open()
    with psycopg.connect(database_url) as conn:
        conn.execute(f"TRUNCATE {TABLE}")
    try:
        yield database
    finally:
        await database.close()


@pytest_asyncio.fixture
async def store(db: Database) -> PostgresRecoveryStore:
    """Return the store under test."""
    return PostgresRecoveryStore(db)


async def test_an_account_starts_with_no_envelope(
    store: PostgresRecoveryStore,
) -> None:
    """Reading before creating finds nothing."""
    assert await store.read(OWNER_A) is None


async def test_create_then_read_returns_the_same_opaque_value(
    store: PostgresRecoveryStore,
) -> None:
    """The stored value is exactly what was sent, at version 1 (AC-18)."""
    created = await store.write(OWNER_A, _request(0))

    assert created == RecoveryEnvelope(
        version=1, format_version=1, wrapped_key=WRAPPED_A
    )
    assert await store.read(OWNER_A) == created


async def test_creating_twice_keeps_the_first(store: PostgresRecoveryStore) -> None:
    """Creation never overwrites an existing envelope."""
    await store.write(OWNER_A, _request(0, WRAPPED_A))

    assert await store.write(OWNER_A, _request(0, WRAPPED_B)) is None
    current = await store.read(OWNER_A)
    assert current is not None
    assert current.wrapped_key == WRAPPED_A


async def test_rotation_swaps_the_key_and_advances_the_version(
    store: PostgresRecoveryStore,
) -> None:
    """After rotation only the new wrapped key is stored."""
    await store.write(OWNER_A, _request(0, WRAPPED_A))

    rotated = await store.write(OWNER_A, _request(1, WRAPPED_B))

    assert rotated == RecoveryEnvelope(
        version=2, format_version=1, wrapped_key=WRAPPED_B
    )
    assert await store.read(OWNER_A) == rotated


@pytest.mark.parametrize("stale", [2, 9])
async def test_a_stale_rotation_changes_nothing(
    store: PostgresRecoveryStore, stale: int
) -> None:
    """An interrupted or out-of-date rotation leaves the old key valid."""
    original = await store.write(OWNER_A, _request(0, WRAPPED_A))

    assert await store.write(OWNER_A, _request(stale, WRAPPED_B)) is None
    assert await store.read(OWNER_A) == original


async def test_rotating_before_creating_stores_nothing(
    store: PostgresRecoveryStore,
) -> None:
    """There is no version 1 to replace."""
    assert await store.write(OWNER_A, _request(1)) is None
    assert await store.read(OWNER_A) is None


async def test_only_one_of_several_simultaneous_rotations_wins(
    store: PostgresRecoveryStore,
) -> None:
    """Compare-and-swap is one statement, so there is exactly one winner."""
    await store.write(OWNER_A, _request(0, WRAPPED_A))

    results = await asyncio.gather(
        *(store.write(OWNER_A, _request(1, WRAPPED_B)) for _ in range(8))
    )

    assert sum(result is not None for result in results) == 1
    current = await store.read(OWNER_A)
    assert current is not None
    assert current.version == 2


async def test_only_one_of_several_simultaneous_creations_wins(
    store: PostgresRecoveryStore,
) -> None:
    """Two devices finishing onboarding together cannot both set the keys."""
    results = await asyncio.gather(
        *(store.write(OWNER_A, _request(0, WRAPPED_A)) for _ in range(8))
    )

    assert sum(result is not None for result in results) == 1


async def test_accounts_cannot_see_or_replace_each_others_envelopes(
    store: PostgresRecoveryStore,
) -> None:
    """Owner B's reads and writes never touch owner A's row (AC-05)."""
    await store.write(OWNER_A, _request(0, WRAPPED_A))

    assert await store.read(OWNER_B) is None
    assert await store.write(OWNER_B, _request(1, WRAPPED_B)) is None
    assert await store.write(OWNER_B, _request(0, WRAPPED_B)) is not None

    kept = await store.read(OWNER_A)
    assert kept is not None
    assert kept.wrapped_key == WRAPPED_A


async def test_row_security_holds_even_for_a_query_with_no_owner_filter(
    db: Database, store: PostgresRecoveryStore
) -> None:
    """The policy, not the WHERE clause, is what keeps accounts apart."""
    await store.write(OWNER_A, _request(0, WRAPPED_A))
    await store.write(OWNER_B, _request(0, WRAPPED_B))

    async with db.as_owner(OWNER_B) as tx:
        cursor = await tx.execute(f"SELECT wrapped_key FROM {TABLE}")
        visible = [value for (value,) in await cursor.fetchall()]
        changed = await tx.execute(f"UPDATE {TABLE} SET wrapped_key = 'eA=='")

    assert visible == [WRAPPED_B]
    assert changed.rowcount == 1
    kept = await store.read(OWNER_A)
    assert kept is not None
    assert kept.wrapped_key == WRAPPED_A


async def test_an_owner_cannot_insert_a_row_for_someone_else(
    db: Database,
) -> None:
    """The policy's WITH CHECK refuses a forged owner."""
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_B) as tx:
            await tx.execute(
                f"INSERT INTO {TABLE} (owner_id, version, format_version, wrapped_key)"
                " VALUES (%s, 1, 1, %s)",
                (OWNER_A, WRAPPED_B),
            )


async def test_the_api_role_cannot_delete_an_envelope(
    db: Database, store: PostgresRecoveryStore
) -> None:
    """An envelope is replaced, never removed, by the API."""
    await store.write(OWNER_A, _request(0))

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(f"DELETE FROM {TABLE}")


@pytest.mark.parametrize("role", BROWSER_ROLES)
async def test_browser_roles_cannot_read_envelopes(
    database_url: str, role: str
) -> None:
    """The Supabase Data API roles have no access to this table."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(f"SET ROLE {role}")
        conn.execute(f"SELECT 1 FROM {TABLE}")


@pytest.mark.parametrize(
    "values",
    ["0, 1, 'eA=='", "1, 0, 'eA=='", "1, 1, ''"],
    ids=["version below 1", "format below 1", "empty wrapped key"],
)
async def test_the_table_refuses_impossible_rows(
    database_url: str, values: str
) -> None:
    """Constraints hold even for a writer that bypasses the API."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.CheckViolation),
    ):
        conn.execute(
            f"INSERT INTO {TABLE} (owner_id, version, format_version, wrapped_key)"
            f" VALUES ('{OWNER_A}', {values})"
        )


async def test_an_envelope_stored_before_verifiers_existed_has_none(
    store: PostgresRecoveryStore, database_url: str
) -> None:
    """Such an account cannot register a device, and says so (ADR-0005).

    Nothing can add a verifier later: only the first write sets it, so that a
    session token alone can never plant one on an account that has keys.
    """
    with psycopg.connect(database_url) as conn:
        conn.execute(
            f"INSERT INTO {TABLE} (owner_id, version, format_version, wrapped_key)"
            " VALUES (%s, 1, 1, 'b2xk')",
            (OWNER_A,),
        )
        conn.commit()

    assert await store.enrollment_key(OWNER_A) is None
    await store.write(OWNER_A, _request(1, "bmV3"))
    assert await store.enrollment_key(OWNER_A) is None
