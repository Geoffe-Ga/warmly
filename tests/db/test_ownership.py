"""Owner-only access is enforced by the database itself (SEC-006, AC-05).

These tests use the ``policy_probe`` table, which exists to prove the pattern
every real table copies.
"""

from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import psycopg
import pytest
import pytest_asyncio

from tests.db.conftest import BROWSER_ROLES
from warmly.db.database import Database

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database and empty the probe table."""
    database = Database(database_url, max_size=2)
    await database.open()
    with psycopg.connect(database_url) as conn:
        conn.execute("TRUNCATE warmly_private.policy_probe")
    try:
        yield database
    finally:
        await database.close()


async def _insert(db: Database, owner: UUID, note: str) -> None:
    """Insert one probe row as ``owner``."""
    async with db.as_owner(owner) as tx:
        await tx.execute(
            "INSERT INTO warmly_private.policy_probe (owner_id, note) VALUES (%s, %s)",
            (owner, note),
        )


async def _notes(db: Database, owner: UUID) -> list[str]:
    """Return every note ``owner`` can see, with no WHERE clause at all."""
    async with db.as_owner(owner) as tx:
        cursor = await tx.execute(
            "SELECT note FROM warmly_private.policy_probe ORDER BY note"
        )
        return [note for (note,) in await cursor.fetchall()]


async def test_an_owner_sees_only_their_own_rows(db: Database) -> None:
    """A query with no owner filter still returns one owner's rows only."""
    await _insert(db, OWNER_A, "a-1")
    await _insert(db, OWNER_A, "a-2")
    await _insert(db, OWNER_B, "b-1")

    assert await _notes(db, OWNER_A) == ["a-1", "a-2"]
    assert await _notes(db, OWNER_B) == ["b-1"]
    assert not await _notes(db, uuid4())


async def test_an_owner_cannot_change_or_delete_another_owners_rows(
    db: Database,
) -> None:
    """Update and delete against someone else's rows match nothing."""
    await _insert(db, OWNER_A, "a-1")

    async with db.as_owner(OWNER_B) as tx:
        updated = await tx.execute("UPDATE warmly_private.policy_probe SET note = 'x'")
        deleted = await tx.execute("DELETE FROM warmly_private.policy_probe")

    assert (updated.rowcount, deleted.rowcount) == (0, 0)
    assert await _notes(db, OWNER_A) == ["a-1"]


async def test_an_owner_cannot_write_a_row_for_someone_else(db: Database) -> None:
    """A forged owner_id is rejected by the policy's WITH CHECK."""
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_B) as tx:
            await tx.execute(
                "INSERT INTO warmly_private.policy_probe (owner_id, note) "
                "VALUES (%s, 'forged')",
                (OWNER_A,),
            )

    assert not await _notes(db, OWNER_A)


async def test_an_owner_cannot_give_a_row_away(db: Database) -> None:
    """Reassigning a row to another owner is rejected too."""
    await _insert(db, OWNER_A, "a-1")

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(
                "UPDATE warmly_private.policy_probe SET owner_id = %s", (OWNER_B,)
            )

    assert not await _notes(db, OWNER_B)


async def test_a_failed_transaction_rolls_back(db: Database) -> None:
    """An exception inside the block leaves no partial write."""

    async def write_then_fail() -> None:
        """Insert a row, then fail before the transaction can commit."""
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(
                "INSERT INTO warmly_private.policy_probe (owner_id, note) "
                "VALUES (%s, 'lost')",
                (OWNER_A,),
            )
            raise RuntimeError

    with pytest.raises(RuntimeError):
        await write_then_fail()

    assert not await _notes(db, OWNER_A)


async def test_owner_and_role_do_not_leak_to_the_next_transaction(
    db: Database, database_url: str
) -> None:
    """A pooled connection carries nothing over from the previous owner."""
    await _insert(db, OWNER_A, "a-1")
    # One connection, so both transactions below are forced to share it.
    single = Database(database_url, max_size=1)
    await single.open()
    try:
        assert await _notes(single, OWNER_A) == ["a-1"]
        assert not await _notes(single, OWNER_B)
    finally:
        await single.close()


async def test_the_api_role_cannot_bypass_row_security_or_alter_tables(
    db: Database,
) -> None:
    """Inside an owner transaction the role has no way around the policy."""
    async with db.as_owner(OWNER_A) as tx:
        cursor = await tx.execute(
            "SELECT current_user, rolbypassrls, rolsuper FROM pg_roles "
            "WHERE rolname = current_user"
        )
        assert await cursor.fetchone() == ("warmly_api", False, False)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(
                "ALTER TABLE warmly_private.policy_probe DISABLE ROW LEVEL SECURITY"
            )


async def test_without_an_owner_nothing_is_visible(database_url: str) -> None:
    """Deny by default: the API role with no owner set sees no rows."""
    with psycopg.connect(database_url) as conn:
        conn.execute("TRUNCATE warmly_private.policy_probe")
        conn.execute(
            "INSERT INTO warmly_private.policy_probe (owner_id, note) "
            "VALUES (%s, 'hidden')",
            (OWNER_A,),
        )
        conn.commit()
        conn.execute("SET ROLE warmly_api")
        visible = conn.execute("SELECT count(*) FROM warmly_private.policy_probe")
        assert visible.fetchone() == (0,)


@pytest.mark.parametrize("role", [*BROWSER_ROLES, "public"])
async def test_browser_roles_have_no_access_to_the_private_schema(
    database_url: str, role: str
) -> None:
    """The Supabase Data API roles cannot use the schema or its tables."""
    with psycopg.connect(database_url) as conn:
        schema = conn.execute(
            "SELECT has_schema_privilege(%s, 'warmly_private', 'USAGE')", (role,)
        ).fetchone()
        table = conn.execute(
            "SELECT has_table_privilege(%s, 'warmly_private.policy_probe', "
            "'SELECT, INSERT, UPDATE, DELETE')",
            (role,),
        ).fetchone()

    assert (schema, table) == ((False,), (False,))


async def test_ping_reports_a_live_database(db: Database) -> None:
    """The readiness probe succeeds against a real database."""
    assert await db.ping()


async def test_ping_reports_a_closed_pool() -> None:
    """A pool that was never opened is not ready."""
    database = Database("postgresql://nobody@127.0.0.1:9/none?connect_timeout=1")

    assert not await database.ping()
