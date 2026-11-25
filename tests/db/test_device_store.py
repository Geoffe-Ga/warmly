"""The devices and nonce tables (ADR-0005; PRD DEV-002, DEV-010, SEC-006).

Run against a real PostgreSQL, because the guarantees are the database's:
row-level security between accounts and a unique key that makes a nonce
usable once.
"""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
import pytest
import pytest_asyncio

from tests.db.conftest import BROWSER_ROLES
from warmly.db.database import Database
from warmly.db.device_store import PostgresDeviceStore
from warmly.db.recovery_store import PostgresRecoveryStore
from warmly.schemas.devices import RegisterDeviceRequest
from warmly.schemas.recovery import PutRecoveryEnvelopeRequest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
DEVICE_1 = UUID("d0000000-0000-4000-8000-000000000001")
DEVICE_2 = UUID("d0000000-0000-4000-8000-000000000002")
KEY = "a2V5"
NAME = "bmFtZQ=="
PROOF = "cHJvb2Y="
LATER = datetime.now(tz=UTC) + timedelta(minutes=10)
EARLIER = datetime.now(tz=UTC) - timedelta(minutes=10)


def _registration(device_id: UUID, key: str = KEY) -> RegisterDeviceRequest:
    """Build a registration request."""
    return RegisterDeviceRequest(
        device_id=device_id,
        public_key=key,
        name_ciphertext=NAME,
        enrollment_proof=PROOF,
    )


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database and empty the tables."""
    database = Database(database_url, max_size=4)
    await database.open()
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "TRUNCATE warmly_private.device_revocations,"
            " warmly_private.device_enrollments,"
            " warmly_private.device_request_nonces, warmly_private.devices,"
            " warmly_private.recovery_envelopes"
        )
    try:
        yield database
    finally:
        await database.close()


@pytest_asyncio.fixture
async def store(db: Database) -> PostgresDeviceStore:
    """Return the store under test."""
    return PostgresDeviceStore(db)


async def test_a_registered_device_is_found_with_its_key(
    store: PostgresDeviceStore,
) -> None:
    """Registration returns the device as current, and it can then be found."""
    device = await store.register(OWNER_A, _registration(DEVICE_1))

    assert device is not None
    assert (device.id, device.public_key, device.name_ciphertext) == (
        DEVICE_1,
        KEY,
        NAME,
    )
    assert device.is_current is True
    assert device.revoked_at is None
    found = await store.find(OWNER_A, DEVICE_1)
    assert found is not None
    assert (found.public_key, found.revoked) == (KEY, False)


async def test_an_unknown_device_is_not_found(store: PostgresDeviceStore) -> None:
    """Nothing is registered yet."""
    assert await store.find(OWNER_A, DEVICE_1) is None


async def test_another_owners_device_is_not_found_listed_or_renamed(
    store: PostgresDeviceStore,
) -> None:
    """Owner B cannot see, list or change owner A's device (DEV-010, AC-05)."""
    await store.register(OWNER_A, _registration(DEVICE_1))

    assert await store.find(OWNER_B, DEVICE_1) is None
    assert not await store.list(OWNER_B, DEVICE_2)
    assert await store.rename(OWNER_B, DEVICE_1, "eA==", DEVICE_2) is None

    (kept,) = await store.list(OWNER_A, DEVICE_1)
    assert kept.name_ciphertext == NAME


async def test_a_device_id_cannot_be_registered_twice_by_anyone(
    store: PostgresDeviceStore,
) -> None:
    """Neither the same account nor another one can take an existing ID."""
    await store.register(OWNER_A, _registration(DEVICE_1))

    assert await store.register(OWNER_A, _registration(DEVICE_1, "b3RoZXI=")) is None
    assert await store.register(OWNER_B, _registration(DEVICE_1, "b3RoZXI=")) is None

    found = await store.find(OWNER_A, DEVICE_1)
    assert found is not None
    assert found.public_key == KEY
    assert await store.find(OWNER_B, DEVICE_1) is None


async def test_only_one_of_several_simultaneous_registrations_wins(
    store: PostgresDeviceStore,
) -> None:
    """The same ID registered at once ends up registered once."""
    results = await asyncio.gather(
        *(store.register(OWNER_A, _registration(DEVICE_1)) for _ in range(6))
    )

    assert sum(result is not None for result in results) == 1


async def test_devices_are_listed_oldest_first_with_the_current_one_marked(
    db: Database, store: PostgresDeviceStore, database_url: str
) -> None:
    """Order is by creation time; exactly the calling device is current."""
    await store.register(OWNER_A, _registration(DEVICE_2))
    await store.register(OWNER_A, _registration(DEVICE_1))
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "UPDATE warmly_private.devices SET created_at = now() - interval '1 day'"
            " WHERE id = %s",
            (DEVICE_1,),
        )

    devices = await store.list(OWNER_A, DEVICE_2)

    assert [(d.id, d.is_current) for d in devices] == [
        (DEVICE_1, False),
        (DEVICE_2, True),
    ]


async def test_renaming_changes_only_the_name(store: PostgresDeviceStore) -> None:
    """The key and creation time are untouched."""
    original = await store.register(OWNER_A, _registration(DEVICE_1))

    renamed = await store.rename(OWNER_A, DEVICE_1, "bmV3", DEVICE_2)

    assert original is not None
    assert renamed is not None
    assert renamed.name_ciphertext == "bmV3"
    assert renamed.is_current is False
    assert (renamed.public_key, renamed.created_at) == (
        original.public_key,
        original.created_at,
    )
    assert await store.rename(OWNER_A, DEVICE_2, "bmV3", DEVICE_1) is None


async def test_a_revoked_device_is_reported_as_revoked(
    store: PostgresDeviceStore, database_url: str
) -> None:
    """The verifier refuses on this flag."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    with psycopg.connect(database_url) as conn:
        conn.execute("UPDATE warmly_private.devices SET revoked_at = now()")

    found = await store.find(OWNER_A, DEVICE_1)

    assert found is not None
    assert found.revoked is True


async def test_a_nonce_can_be_used_once_per_device(store: PostgresDeviceStore) -> None:
    """A second use is a replay; another device may use the same value."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.register(OWNER_A, _registration(DEVICE_2))
    nonce = "n" * 24

    assert await store.use_nonce(OWNER_A, DEVICE_1, nonce, LATER)
    assert not await store.use_nonce(OWNER_A, DEVICE_1, nonce, LATER)
    assert await store.use_nonce(OWNER_A, DEVICE_2, nonce, LATER)


async def test_the_same_nonce_sent_many_times_at_once_is_accepted_once(
    store: PostgresDeviceStore,
) -> None:
    """Replay protection holds under a race."""
    await store.register(OWNER_A, _registration(DEVICE_1))

    results = await asyncio.gather(
        *(store.use_nonce(OWNER_A, DEVICE_1, "r" * 24, LATER) for _ in range(8))
    )

    assert sum(results) == 1


async def test_expired_nonces_are_forgotten_as_new_ones_arrive(
    store: PostgresDeviceStore, database_url: str
) -> None:
    """The table holds only the last few minutes of requests."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.use_nonce(OWNER_A, DEVICE_1, "o" * 24, EARLIER)

    await store.use_nonce(OWNER_A, DEVICE_1, "p" * 24, LATER)

    with psycopg.connect(database_url) as conn:
        nonces = conn.execute(
            "SELECT nonce FROM warmly_private.device_request_nonces"
        ).fetchall()
    assert nonces == [("p" * 24,)]


async def test_an_owner_cannot_record_a_nonce_for_someone_elses_row(
    db: Database, store: PostgresDeviceStore
) -> None:
    """The policy's WITH CHECK refuses a forged owner."""
    await store.register(OWNER_A, _registration(DEVICE_1))

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_B) as tx:
            await tx.execute(
                "INSERT INTO warmly_private.device_request_nonces"
                " (device_id, nonce, owner_id, expires_at) VALUES (%s, %s, %s, now())",
                (DEVICE_1, "x" * 24, OWNER_A),
            )


async def test_the_api_role_cannot_delete_a_device(
    db: Database, store: PostgresDeviceStore
) -> None:
    """A device is revoked, never removed, so its ID can never be reused."""
    await store.register(OWNER_A, _registration(DEVICE_1))

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute("DELETE FROM warmly_private.devices")


@pytest.mark.parametrize("table", ["devices", "device_request_nonces"])
@pytest.mark.parametrize("role", BROWSER_ROLES)
async def test_browser_roles_cannot_read_device_tables(
    database_url: str, role: str, table: str
) -> None:
    """The Supabase Data API roles have no access."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(f"SET ROLE {role}")
        conn.execute(f"SELECT 1 FROM warmly_private.{table}")


async def test_the_enrollment_verifier_is_stored_with_the_first_envelope_only(
    db: Database,
) -> None:
    """It is set on create, kept through rotation, and private to its owner."""
    recovery = PostgresRecoveryStore(db)
    assert await recovery.enrollment_verifier(OWNER_A) is None

    await recovery.write(
        OWNER_A,
        PutRecoveryEnvelopeRequest(
            expected_version=0,
            format_version=1,
            wrapped_key="QUFBQQ==",
            device_enrollment_verifier="dmVyaWZpZXI=",
        ),
    )
    await recovery.write(
        OWNER_A,
        PutRecoveryEnvelopeRequest(
            expected_version=1, format_version=1, wrapped_key="QkJCQg=="
        ),
    )

    assert await recovery.enrollment_verifier(OWNER_A) == "dmVyaWZpZXI="
    assert await recovery.enrollment_verifier(OWNER_B) is None


async def test_revoking_marks_the_device_and_writes_the_ledger(
    store: PostgresDeviceStore, db: Database
) -> None:
    """Both happen together, and the device is refused from then on (AC-20)."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.register(OWNER_A, _registration(DEVICE_2))

    revoked = await store.revoke(OWNER_A, DEVICE_2, DEVICE_1)

    assert revoked is not None
    assert revoked.id == DEVICE_2
    assert revoked.revoked_at is not None
    assert revoked.is_current is False
    found = await store.find(OWNER_A, DEVICE_2)
    assert found is not None
    assert found.revoked is True
    still_fine = await store.find(OWNER_A, DEVICE_1)
    assert still_fine is not None
    assert still_fine.revoked is False
    async with db.as_owner(OWNER_A) as tx:
        cursor = await tx.execute(
            "SELECT device_id, owner_id, revoked_by, revoked_at"
            " FROM warmly_private.device_revocations"
        )
        ledger = await cursor.fetchall()
    assert ledger == [(DEVICE_2, OWNER_A, DEVICE_1, revoked.revoked_at)]


async def test_a_device_can_revoke_itself(store: PostgresDeviceStore) -> None:
    """A device can revoke itself."""
    await store.register(OWNER_A, _registration(DEVICE_1))

    revoked = await store.revoke(OWNER_A, DEVICE_1, DEVICE_1)

    assert revoked is not None
    assert revoked.is_current is True
    assert revoked.revoked_at is not None


async def test_revoking_twice_keeps_the_first_time_and_one_ledger_row(
    store: PostgresDeviceStore, db: Database
) -> None:
    """Revoking twice keeps the first time and one ledger row."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.register(OWNER_A, _registration(DEVICE_2))
    first = await store.revoke(OWNER_A, DEVICE_2, DEVICE_1)

    again = await asyncio.gather(
        *(store.revoke(OWNER_A, DEVICE_2, DEVICE_1) for _ in range(6))
    )

    assert first is not None
    assert all(r is not None and r.revoked_at == first.revoked_at for r in again)
    async with db.as_owner(OWNER_A) as tx:
        cursor = await tx.execute(
            "SELECT count(*) FROM warmly_private.device_revocations"
        )
        assert await cursor.fetchone() == (1,)


async def test_another_owner_cannot_revoke_or_see_the_ledger(
    store: PostgresDeviceStore, db: Database
) -> None:
    """Owner B can neither revoke owner A's device nor learn it was revoked."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.register(OWNER_B, _registration(DEVICE_2))

    assert await store.revoke(OWNER_B, DEVICE_1, DEVICE_2) is None

    untouched = await store.find(OWNER_A, DEVICE_1)
    assert untouched is not None
    assert untouched.revoked is False
    await store.revoke(OWNER_A, DEVICE_1, DEVICE_1)
    async with db.as_owner(OWNER_B) as tx:
        cursor = await tx.execute("SELECT 1 FROM warmly_private.device_revocations")
        assert await cursor.fetchall() == []


async def test_a_revoked_device_id_cannot_be_registered_again(
    store: PostgresDeviceStore,
) -> None:
    """Rejoining takes a new device ID (DEV-003)."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.revoke(OWNER_A, DEVICE_1, DEVICE_1)

    assert await store.register(OWNER_A, _registration(DEVICE_1, "bmV3")) is None
    assert await store.register(OWNER_B, _registration(DEVICE_1, "bmV3")) is None
    found = await store.find(OWNER_A, DEVICE_1)
    assert found is not None
    assert (found.public_key, found.revoked) == (KEY, True)


async def test_the_database_refuses_to_undo_or_move_a_revocation(
    store: PostgresDeviceStore, db: Database
) -> None:
    """Even code that tried could not re-activate a device."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.revoke(OWNER_A, DEVICE_1, DEVICE_1)

    for value in ("NULL", "now() + interval '1 day'"):
        with pytest.raises(psycopg.errors.CheckViolation):
            async with db.as_owner(OWNER_A) as tx:
                await tx.execute(
                    f"UPDATE warmly_private.devices SET revoked_at = {value}"
                    " WHERE id = %s",
                    (DEVICE_1,),
                )
    # A rename still works: only the revocation is frozen.
    assert await store.rename(OWNER_A, DEVICE_1, "bmV3", DEVICE_1) is not None


@pytest.mark.parametrize("statement", ["UPDATE", "DELETE"])
async def test_the_ledger_is_append_only(
    store: PostgresDeviceStore, db: Database, statement: str
) -> None:
    """The ledger is append only."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.revoke(OWNER_A, DEVICE_1, DEVICE_1)
    sql = {
        "UPDATE": "UPDATE warmly_private.device_revocations SET revoked_at = now()",
        "DELETE": "DELETE FROM warmly_private.device_revocations",
    }[statement]

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(sql)


@pytest.mark.parametrize("role", BROWSER_ROLES)
async def test_browser_roles_cannot_read_the_ledger(
    database_url: str, role: str
) -> None:
    """Browser roles cannot read the ledger."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(f"SET ROLE {role}")
        conn.execute("SELECT 1 FROM warmly_private.device_revocations")


async def test_marking_a_device_synced_sets_its_last_sync_time_only(
    store: PostgresDeviceStore,
) -> None:
    """Manage Devices shows when each device last caught up (DEV-002)."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.register(OWNER_A, _registration(DEVICE_2, "b3RoZXI="))
    before = {device.id: device for device in await store.list(OWNER_A, DEVICE_1)}
    assert before[DEVICE_1].last_sync_at is None

    await store.mark_synced(OWNER_A, DEVICE_1)

    after = {device.id: device for device in await store.list(OWNER_A, DEVICE_1)}
    synced = after[DEVICE_1].last_sync_at
    assert synced is not None
    assert synced >= after[DEVICE_1].created_at
    assert after[DEVICE_1] == before[DEVICE_1].model_copy(
        update={"last_sync_at": synced}
    )
    assert after[DEVICE_2] == before[DEVICE_2]


async def test_another_owner_cannot_mark_a_device_synced(
    store: PostgresDeviceStore,
) -> None:
    """Row-level security keeps the update to the caller's own devices."""
    await store.register(OWNER_A, _registration(DEVICE_1))

    await store.mark_synced(OWNER_B, DEVICE_1)

    (device,) = await store.list(OWNER_A, DEVICE_1)
    assert device.last_sync_at is None


async def test_a_revoked_device_is_never_marked_synced(
    store: PostgresDeviceStore,
) -> None:
    """A device that was removed stops showing activity."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.register(OWNER_A, _registration(DEVICE_2, "b3RoZXI="))
    await store.revoke(OWNER_A, DEVICE_2, DEVICE_1)

    await store.mark_synced(OWNER_A, DEVICE_2)

    devices = {device.id: device for device in await store.list(OWNER_A, DEVICE_1)}
    assert devices[DEVICE_2].last_sync_at is None


async def test_a_recent_last_sync_time_is_not_rewritten(
    db: Database, store: PostgresDeviceStore
) -> None:
    """A device that polls often does not write to the table every time."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    assert await store.mark_synced(OWNER_A, DEVICE_1)
    (first,) = await store.list(OWNER_A, DEVICE_1)

    assert await store.mark_synced(OWNER_A, DEVICE_1)

    (second,) = await store.list(OWNER_A, DEVICE_1)
    assert second.last_sync_at == first.last_sync_at


async def test_an_old_last_sync_time_is_brought_up_to_date(
    database_url: str, store: PostgresDeviceStore
) -> None:
    """After five minutes the next sync is recorded again."""
    await store.register(OWNER_A, _registration(DEVICE_1))
    await store.mark_synced(OWNER_A, DEVICE_1)
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "UPDATE warmly_private.devices"
            " SET last_sync_at = now() - interval '6 minutes'"
        )
    (old,) = await store.list(OWNER_A, DEVICE_1)

    await store.mark_synced(OWNER_A, DEVICE_1)

    (new,) = await store.list(OWNER_A, DEVICE_1)
    assert old.last_sync_at is not None
    assert new.last_sync_at is not None
    assert new.last_sync_at > old.last_sync_at
