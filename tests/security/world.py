"""The two accounts the adversarial suite plays against each other."""

import base64
import json
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from httpx2 import Response
from psycopg import sql
from psycopg.rows import TupleRow

from tests.api.cases import BYTES32, commitment
from tests.auth.devices import ENROLLMENT_KEY, TestDevice
from tests.auth.tokens import Signer

JSON = {"Content-Type": "application/json"}


def owned_tables(conn: psycopg.Connection[TupleRow]) -> list[str]:
    """Return every private table that has an owner column."""
    rows = conn.execute(
        "SELECT table_name FROM information_schema.columns"
        " WHERE table_schema = 'warmly_private' AND column_name = 'owner_id'"
        " ORDER BY table_name"
    ).fetchall()
    return [row[0] for row in rows]


def _marker(text: str) -> str:
    """Return a recognisable synthetic ciphertext."""
    return base64.b64encode(text.encode()).decode()


@dataclass(frozen=True)
class Ids:
    """The identifiers a request can name."""

    device_id: str
    enrollment_id: str
    record_id: str

    @staticmethod
    def unknown() -> "Ids":
        """Return identifiers that belong to nobody."""
        return Ids(str(uuid4()), str(uuid4()), str(uuid4()))


@dataclass
class Account:
    """One account: its token, its device and what it owns."""

    name: str
    owner_id: str
    token: str
    device: TestDevice
    ids: Ids
    payload: str
    wrapped_key: str
    # A second registered device, for tests that revoke one.
    spare: TestDevice = field(default_factory=TestDevice)

    @property
    def secrets(self) -> tuple[str, ...]:
        """Everything that must never appear in another account's responses."""
        return (
            self.owner_id,
            self.ids.device_id,
            self.ids.enrollment_id,
            self.ids.record_id,
            self.device.public_key,
            self.spare.device_id,
            self.payload,
            self.wrapped_key,
        )


@dataclass
class World:
    """The application, its database and accounts A (the target) and B."""

    client: TestClient
    signer: Signer
    database_url: str
    a: Account
    b: Account

    @staticmethod
    def build(client: TestClient, signer: Signer, database_url: str) -> "World":
        """Set both accounts up through the API."""
        world = World(
            client,
            signer,
            database_url,
            _account(client, signer, "A"),
            _account(client, signer, "B"),
        )
        return world

    def send(
        self,
        method: str,
        path: str,
        *,
        token: str | None,
        body: dict[str, Any] | None = None,
        signed_by: TestDevice | None = None,
        named_device: str | None = None,
        headers: dict[str, str] | None = None,
        nonce: str | None = None,
    ) -> Response:
        """Send one request exactly as described, with no defaults added.

        Args:
            method: The HTTP method.
            path: The path and query.
            token: The bearer token, or ``None`` for no ``Authorization``.
            body: A JSON body, if any.
            signed_by: The device key that signs the request, if any.
            named_device: The device ID the signature claims, if not the
                signing device's own.
            headers: Extra headers.
            nonce: A fixed nonce, to send the same signed request twice.

        Returns:
            The response.
        """
        content = b"" if body is None else json.dumps(body).encode()
        sent: dict[str, str] = dict(headers or {})
        if token is not None:
            sent["Authorization"] = f"Bearer {token}"
        if body is not None:
            sent |= JSON
        if signed_by is not None:
            sent |= signed_by.headers(
                method, path, content, nonce=nonce, device_id=named_device
            )
        return self.client.request(method, path, content=content, headers=sent)

    def snapshot(self, account: Account) -> dict[str, list[tuple[Any, ...]]]:
        """Return every row an account owns, in every private table."""
        with psycopg.connect(self.database_url) as conn:
            return {
                table: sorted(
                    conn.execute(
                        sql.SQL(
                            "SELECT * FROM warmly_private.{} WHERE owner_id = %s"
                        ).format(sql.Identifier(table)),
                        (account.owner_id,),
                    ).fetchall(),
                    key=repr,
                )
                for table in owned_tables(conn)
            }


def _account(client: TestClient, signer: Signer, name: str) -> Account:
    """Create an account with keys, two devices, a record and a pairing request."""
    owner_id = str(uuid4())
    token = signer.token(sub=owner_id)
    bearer = {"Authorization": f"Bearer {token}"}
    wrapped_key = _marker(f"{name}-WRAPPED-ROOT-KEY")
    payload = _marker(f"{name}-JOURNAL-CIPHERTEXT")

    def call(
        method: str,
        path: str,
        body: dict[str, Any],
        signed_by: TestDevice | None = None,
    ) -> Response:
        content = json.dumps(body).encode()
        headers = bearer | JSON
        if signed_by is not None:
            headers |= signed_by.headers(method, path, content)
        response = client.request(method, path, content=content, headers=headers)
        assert response.status_code in {200, 201}, (name, path, response.text)
        return response

    call(
        "PUT",
        "/v1/recovery-envelope",
        {
            "expected_version": 0,
            "format_version": 1,
            "wrapped_key": wrapped_key,
            "device_enrollment_key": ENROLLMENT_KEY,
        },
    )
    device = TestDevice(device_id=str(uuid4()))
    spare = TestDevice(device_id=str(uuid4()))
    for each in (device, spare):
        call("POST", "/v1/devices", each.registration(), signed_by=each)
    record_id = str(uuid4())
    call(
        "POST",
        "/v1/sync/operations",
        {
            "operations": [
                {
                    "op_id": str(uuid4()),
                    "record_id": record_id,
                    "type": 1,
                    "base_revision": 0,
                    "schema_version": 1,
                    "tombstone": False,
                    "payload": payload,
                }
            ]
        },
        signed_by=device,
    )
    joining = TestDevice(device_id=str(uuid4()))
    enrollment = call(
        "POST",
        "/v1/enrollments",
        {
            "device_id": joining.device_id,
            "public_key": joining.public_key,
            "commitment": commitment(joining.device_id, joining.public_key, BYTES32),
        },
    ).json()
    return Account(
        name=name,
        owner_id=owner_id,
        token=token,
        device=device,
        ids=Ids(device.device_id, enrollment["id"], record_id),
        payload=payload,
        wrapped_key=wrapped_key,
        spare=spare,
    )
