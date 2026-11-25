"""The device pairing table (ADR-0005; PRD DEV-001 path A, AC-19).

Run against a real PostgreSQL, because the guarantees are the database's:
row-level security between accounts, and single ``UPDATE`` statements that
let each step of a pairing happen exactly once.
"""

import asyncio
import base64
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
import pytest
import pytest_asyncio

from tests.db.conftest import BROWSER_ROLES
from warmly.db.database import Database
from warmly.db.device_store import PostgresDeviceStore
from warmly.db.enrollment_store import ENROLLMENT_LIFETIME, PostgresEnrollmentStore
from warmly.schemas.devices import RegisterDeviceRequest
from warmly.schemas.enrollment import Enrollment, StartEnrollmentRequest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

TABLE = "warmly_private.device_enrollments"
OWNER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
APPROVER = UUID("d0000000-0000-4000-8000-000000000001")
OTHER_APPROVER = UUID("d0000000-0000-4000-8000-000000000002")
THEIR_DEVICE = UUID("d0000000-0000-4000-8000-000000000003")
NEW_DEVICE = UUID("d0000000-0000-4000-8000-0000000000aa")
UNKNOWN = UUID("99999999-9999-4999-8999-999999999999")
# 32 synthetic bytes in base64.
VALUE_1 = base64.b64encode(bytes(range(32))).decode()
VALUE_2 = base64.b64encode(bytes(range(32, 64))).decode()
WRAPPED = "d3JhcHBlZA=="


def _start() -> StartEnrollmentRequest:
    """Build a start request."""
    return StartEnrollmentRequest(
        device_id=NEW_DEVICE, public_key="a2V5", commitment=VALUE_1
    )


@pytest_asyncio.fixture
async def db(database_url: str) -> AsyncIterator[Database]:
    """Open a pool on the migrated database, empty it, and register devices."""
    database = Database(database_url, max_size=4)
    await database.open()
    with psycopg.connect(database_url) as conn:
        conn.execute(
            f"TRUNCATE {TABLE}, warmly_private.device_request_nonces,"
            " warmly_private.devices"
        )
    devices = PostgresDeviceStore(database)
    for owner, device in (
        (OWNER_A, APPROVER),
        (OWNER_A, OTHER_APPROVER),
        (OWNER_B, THEIR_DEVICE),
    ):
        await devices.register(
            owner,
            RegisterDeviceRequest(
                device_id=device,
                public_key="a2V5",
                name_ciphertext="bmFtZQ==",
                enrollment_proof="cHJvb2Y=",
            ),
        )
    try:
        yield database
    finally:
        await database.close()


@pytest_asyncio.fixture
async def store(db: Database) -> PostgresEnrollmentStore:
    """Return the store under test."""
    return PostgresEnrollmentStore(db)


def _expire(database_url: str, enrollment_id: UUID) -> None:
    """Move a request's expiry into the past."""
    with psycopg.connect(database_url) as conn:
        conn.execute(
            f"UPDATE {TABLE} SET expires_at = now() - interval '1 second'"
            " WHERE id = %s",
            (enrollment_id,),
        )
        conn.commit()


async def _revealed(store: PostgresEnrollmentStore) -> Enrollment:
    """Run a pairing up to the point where the code can be compared."""
    started = await store.start(OWNER_A, _start())
    await store.claim(OWNER_A, started.id, APPROVER, VALUE_2)
    revealed = await store.reveal(OWNER_A, started.id, VALUE_1)
    assert revealed is not None
    return revealed


async def test_a_started_request_is_pending_with_a_fresh_challenge_and_expiry(
    store: PostgresEnrollmentStore,
) -> None:
    before = datetime.now(tz=UTC)

    first = await store.start(OWNER_A, _start())
    second = await store.start(OWNER_B, _start())

    assert first.status == "pending"
    assert (first.device_id, first.public_key, first.commitment) == (
        NEW_DEVICE,
        "a2V5",
        VALUE_1,
    )
    assert first.id != second.id
    assert first.challenge != second.challenge
    assert len(first.challenge) == 44
    assert first.approver_nonce is None
    assert first.joiner_nonce is None
    assert first.wrapped_key is None
    lifetime = first.expires_at - before
    assert ENROLLMENT_LIFETIME - timedelta(seconds=5) < lifetime
    assert lifetime < ENROLLMENT_LIFETIME + timedelta(seconds=5)
    assert await store.read(OWNER_A, first.id) == first


async def test_a_whole_pairing_ends_with_the_wrapped_key_relayed_unchanged(
    store: PostgresEnrollmentStore,
) -> None:
    started = await store.start(OWNER_A, _start())

    claimed = await store.claim(OWNER_A, started.id, APPROVER, VALUE_2)
    revealed = await store.reveal(OWNER_A, started.id, VALUE_1)
    approved = await store.approve(OWNER_A, started.id, APPROVER, WRAPPED)

    assert claimed is not None
    assert (claimed.status, claimed.approver_nonce) == ("claimed", VALUE_2)
    assert revealed is not None
    assert (revealed.status, revealed.joiner_nonce) == ("revealed", VALUE_1)
    assert approved is not None
    assert (approved.status, approved.wrapped_key) == ("approved", WRAPPED)
    assert await store.read(OWNER_A, started.id) == approved


async def test_each_step_happens_once_and_in_order(
    store: PostgresEnrollmentStore,
) -> None:
    started = await store.start(OWNER_A, _start())

    assert await store.reveal(OWNER_A, started.id, VALUE_1) is None
    assert await store.approve(OWNER_A, started.id, APPROVER, WRAPPED) is None
    assert await store.reject(OWNER_A, started.id, APPROVER) is None

    assert await store.claim(OWNER_A, started.id, APPROVER, VALUE_2) is not None
    assert await store.claim(OWNER_A, started.id, OTHER_APPROVER, VALUE_1) is None
    assert await store.approve(OWNER_A, started.id, APPROVER, WRAPPED) is None

    assert await store.reveal(OWNER_A, started.id, VALUE_1) is not None
    assert await store.reveal(OWNER_A, started.id, VALUE_2) is None

    assert await store.approve(OWNER_A, started.id, APPROVER, WRAPPED) is not None
    assert await store.approve(OWNER_A, started.id, APPROVER, "b3RoZXI=") is None
    assert await store.reject(OWNER_A, started.id, APPROVER) is None

    final = await store.read(OWNER_A, started.id)
    assert final is not None
    assert (final.approver_nonce, final.joiner_nonce, final.wrapped_key) == (
        VALUE_2,
        VALUE_1,
        WRAPPED,
    )


async def test_only_one_of_several_devices_claiming_at_once_wins(
    store: PostgresEnrollmentStore,
) -> None:
    started = await store.start(OWNER_A, _start())

    results = await asyncio.gather(
        *(
            store.claim(OWNER_A, started.id, device, VALUE_2)
            for device in (APPROVER, OTHER_APPROVER) * 4
        )
    )

    assert sum(result is not None for result in results) == 1


async def test_only_the_claiming_device_can_approve_or_reject(
    store: PostgresEnrollmentStore,
) -> None:
    revealed = await _revealed(store)

    assert await store.approve(OWNER_A, revealed.id, OTHER_APPROVER, WRAPPED) is None
    assert await store.reject(OWNER_A, revealed.id, OTHER_APPROVER) is None

    rejected = await store.reject(OWNER_A, revealed.id, APPROVER)
    assert rejected is not None
    assert rejected.status == "rejected"
    assert await store.approve(OWNER_A, revealed.id, APPROVER, WRAPPED) is None


async def test_an_approver_must_be_a_registered_device(
    store: PostgresEnrollmentStore,
) -> None:
    """The table refuses a claim by a device ID that was never registered."""
    started = await store.start(OWNER_A, _start())

    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        await store.claim(OWNER_A, started.id, UNKNOWN, VALUE_2)


async def test_an_expired_request_reads_as_expired_and_cannot_be_advanced(
    store: PostgresEnrollmentStore, database_url: str
) -> None:
    revealed = await _revealed(store)
    pending = await store.start(OWNER_B, _start())
    _expire(database_url, revealed.id)
    _expire(database_url, pending.id)

    assert await store.approve(OWNER_A, revealed.id, APPROVER, WRAPPED) is None
    assert await store.reject(OWNER_A, revealed.id, APPROVER) is None
    assert await store.claim(OWNER_B, pending.id, THEIR_DEVICE, VALUE_2) is None
    assert await store.open_request(OWNER_B) is None
    expired = await store.read(OWNER_A, revealed.id)
    assert expired is not None
    assert expired.status == "expired"


async def test_an_expired_request_gives_up_no_wrapped_key(
    store: PostgresEnrollmentStore, database_url: str
) -> None:
    revealed = await _revealed(store)
    await store.approve(OWNER_A, revealed.id, APPROVER, WRAPPED)
    _expire(database_url, revealed.id)

    expired = await store.read(OWNER_A, revealed.id)

    assert expired is not None
    assert (expired.status, expired.wrapped_key) == ("expired", None)


async def test_starting_again_ends_the_owners_open_requests_only(
    store: PostgresEnrollmentStore,
) -> None:
    mine = await store.start(OWNER_A, _start())
    await store.claim(OWNER_A, mine.id, APPROVER, VALUE_2)
    theirs = await store.start(OWNER_B, _start())

    newer = await store.start(OWNER_A, _start())

    ended = await store.read(OWNER_A, mine.id)
    assert ended is not None
    assert ended.status == "expired"
    assert await store.reveal(OWNER_A, mine.id, VALUE_1) is None
    open_a = await store.open_request(OWNER_A)
    open_b = await store.open_request(OWNER_B)
    assert open_a is not None
    assert open_a.id == newer.id
    assert open_b is not None
    assert open_b.id == theirs.id


async def test_starting_again_does_not_disturb_a_finished_request(
    store: PostgresEnrollmentStore,
) -> None:
    revealed = await _revealed(store)
    await store.approve(OWNER_A, revealed.id, APPROVER, WRAPPED)

    await store.start(OWNER_A, _start())

    finished = await store.read(OWNER_A, revealed.id)
    assert finished is not None
    assert (finished.status, finished.wrapped_key) == ("approved", WRAPPED)


async def test_the_open_request_is_the_one_nobody_has_claimed(
    store: PostgresEnrollmentStore,
) -> None:
    assert await store.open_request(OWNER_A) is None
    started = await store.start(OWNER_A, _start())
    assert await store.open_request(OWNER_A) == started

    await store.claim(OWNER_A, started.id, APPROVER, VALUE_2)

    assert await store.open_request(OWNER_A) is None


async def test_requests_long_expired_are_removed_when_a_new_one_starts(
    store: PostgresEnrollmentStore, database_url: str
) -> None:
    old = await store.start(OWNER_A, _start())
    recent = await store.start(OWNER_A, _start())
    with psycopg.connect(database_url) as conn:
        conn.execute(
            f"UPDATE {TABLE} SET expires_at = now() - interval '2 hours' WHERE id = %s",
            (old.id,),
        )
        conn.commit()

    await store.start(OWNER_A, _start())

    assert await store.read(OWNER_A, old.id) is None
    assert await store.read(OWNER_A, recent.id) is not None


async def test_accounts_cannot_see_or_advance_each_others_requests(
    store: PostgresEnrollmentStore,
) -> None:
    """Pairing can never cross accounts (AC-19, scope fence)."""
    started = await store.start(OWNER_A, _start())

    assert await store.read(OWNER_B, started.id) is None
    assert await store.open_request(OWNER_B) is None
    assert await store.claim(OWNER_B, started.id, THEIR_DEVICE, VALUE_2) is None
    assert await store.reveal(OWNER_B, started.id, VALUE_1) is None

    await store.claim(OWNER_A, started.id, APPROVER, VALUE_2)
    await store.reveal(OWNER_A, started.id, VALUE_1)
    assert await store.approve(OWNER_B, started.id, THEIR_DEVICE, WRAPPED) is None
    assert await store.approve(OWNER_B, started.id, APPROVER, WRAPPED) is None
    assert await store.reject(OWNER_B, started.id, APPROVER) is None
    untouched = await store.read(OWNER_A, started.id)
    assert untouched is not None
    assert untouched.status == "revealed"


async def test_row_security_holds_even_for_a_query_with_no_owner_filter(
    store: PostgresEnrollmentStore, db: Database
) -> None:
    await store.start(OWNER_A, _start())
    await store.start(OWNER_B, _start())

    async with db.as_owner(OWNER_A) as tx:
        cursor = await tx.execute(f"SELECT owner_id FROM {TABLE}")
        rows = await cursor.fetchall()

    assert rows == [(OWNER_A,)]


async def test_an_owner_cannot_insert_a_request_for_someone_else(
    db: Database,
) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.as_owner(OWNER_A) as tx:
            await tx.execute(
                f"INSERT INTO {TABLE} (id, owner_id, device_id, public_key,"
                " commitment, challenge, expires_at)"
                " VALUES (%s, %s, %s, 'a2V5', 'Yw==', 'Yw==', now())",
                (UNKNOWN, OWNER_B, NEW_DEVICE),
            )


@pytest.mark.parametrize("role", BROWSER_ROLES)
async def test_browser_roles_cannot_read_pairing_requests(
    database_url: str, role: str
) -> None:
    """The Supabase Data API roles have no access."""
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(f"SET ROLE {role}")
        conn.execute(f"SELECT 1 FROM {TABLE}")


async def test_the_table_refuses_an_unknown_status(database_url: str) -> None:
    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(psycopg.errors.CheckViolation),
    ):
        conn.execute(
            f"INSERT INTO {TABLE} (id, owner_id, device_id, public_key,"
            " commitment, challenge, status, expires_at)"
            " VALUES (%s, %s, %s, 'a2V5', 'Yw==', 'Yw==', 'done', now())",
            (UNKNOWN, OWNER_A, NEW_DEVICE),
        )
