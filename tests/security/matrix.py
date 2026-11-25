"""Every signed-in route and every attack tried against it (SEC-005, SEC-006).

The routes come from the OpenAPI contract: a route that is in the contract
and not in ``OPERATIONS`` fails the suite, so a new route cannot ship
without being attacked. ``docs/security/isolation-test-matrix.md`` is
written from this module.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from tests.api.cases import BYTES32, CIPHERTEXT
from tests.security.world import Ids

# Routes anyone may call. They carry no account and return nothing private.
PUBLIC = frozenset({("GET", "/v1/health"), ("GET", "/v1/ready")})


def _operations(ids: Ids) -> dict[str, Any]:
    return {
        "operations": [
            {
                "op_id": str(uuid4()),
                "record_id": ids.record_id,
                "type": 1,
                # On top of a revision the caller has never been given.
                "base_revision": 1,
                "schema_version": 1,
                "tombstone": False,
                "payload": CIPHERTEXT,
            }
        ]
    }


def _registration(ids: Ids) -> dict[str, Any]:
    return {
        "device_id": ids.device_id,
        "public_key": CIPHERTEXT,
        "name_ciphertext": CIPHERTEXT,
        "enrollment_proof": BYTES32,
    }


def _start(ids: Ids) -> dict[str, Any]:
    return {
        "device_id": ids.device_id,
        "public_key": CIPHERTEXT,
        "commitment": BYTES32,
    }


@dataclass(frozen=True)
class Operation:
    """One route, and how to ask it about a given set of identifiers."""

    method: str
    template: str
    # Whether the route needs a registered device's signature. The others
    # are used before a device is registered (ADR-0005).
    signed: bool
    # Whether the request is signed by the very device it registers. Only
    # registration: a device proves it holds the key it is enrolling.
    self_signed: bool = False
    body: Callable[[Ids], dict[str, Any]] | None = None
    # Whether the body names a device or record by ID.
    body_names_ids: bool = False

    @property
    def key(self) -> tuple[str, str]:
        """Return the method and path template."""
        return (self.method, self.template)

    @property
    def names_ids(self) -> bool:
        """Report whether a request to this route can name someone's data."""
        return "{" in self.template or self.body_names_ids

    def path(self, ids: Ids) -> str:
        """Return the path for a set of identifiers."""
        return self.template.format(
            device_id=ids.device_id, enrollment_id=ids.enrollment_id
        )

    def request(self, ids: Ids) -> tuple[str, dict[str, Any] | None]:
        """Return the path and body for a set of identifiers."""
        return self.path(ids), None if self.body is None else self.body(ids)

    def __str__(self) -> str:
        """Return the route as it is written in the contract."""
        return f"{self.method} {self.template}"


_ENROLLMENT = "/v1/enrollments/{enrollment_id}"

OPERATIONS: tuple[Operation, ...] = (
    Operation("GET", "/v1/sync/changes", signed=True),
    Operation(
        "POST",
        "/v1/sync/operations",
        signed=True,
        body=_operations,
        body_names_ids=True,
    ),
    Operation("GET", "/v1/devices", signed=True),
    Operation(
        "POST",
        "/v1/devices",
        signed=False,
        self_signed=True,
        body=_registration,
        body_names_ids=True,
    ),
    Operation(
        "PATCH",
        "/v1/devices/{device_id}",
        signed=True,
        body=lambda _ids: {"name_ciphertext": CIPHERTEXT},
    ),
    Operation("POST", "/v1/devices/{device_id}/revoke", signed=True),
    Operation(
        "POST", "/v1/enrollments", signed=False, body=_start, body_names_ids=True
    ),
    Operation("GET", "/v1/enrollments/open", signed=True),
    Operation("GET", _ENROLLMENT, signed=False),
    Operation(
        "POST",
        _ENROLLMENT + "/claim",
        signed=True,
        body=lambda _ids: {"approver_nonce": BYTES32},
    ),
    Operation(
        "POST",
        _ENROLLMENT + "/reveal",
        signed=False,
        body=lambda _ids: {"joiner_nonce": BYTES32},
    ),
    Operation("POST", _ENROLLMENT + "/cancel", signed=False),
    Operation(
        "POST",
        _ENROLLMENT + "/approve",
        signed=True,
        body=lambda _ids: {"wrapped_key": CIPHERTEXT},
    ),
    Operation("POST", _ENROLLMENT + "/reject", signed=True),
    Operation("GET", "/v1/recovery-envelope", signed=False),
    # Replacing an envelope needs a device. Creating the first one, before
    # any device exists, does not; both accounts here already have one.
    Operation(
        "PUT",
        "/v1/recovery-envelope",
        signed=True,
        body=lambda _ids: {
            "expected_version": 7,
            "format_version": 1,
            "wrapped_key": CIPHERTEXT,
        },
    ),
)


@dataclass(frozen=True)
class Attack:
    """One way of trying to reach another account's data."""

    name: str
    what: str
    # Whether it only applies to routes that need a registered device.
    needs_signed_route: bool = False
    # Whether it also applies to the route a device signs for itself.
    covers_self_signed: bool = False
    # Whether it only means something where a request can name data.
    needs_ids: bool = False

    def applies_to(self, operation: Operation) -> bool:
        """Report whether the attack means anything for a route."""
        signed = operation.signed or (operation.self_signed and self.covers_self_signed)
        if self.needs_signed_route and not signed:
            return False
        return operation.names_ids or not self.needs_ids


ATTACKS: tuple[Attack, ...] = (
    Attack(
        "another account's identifiers",
        "B names A's device, pairing request and record. The answer must be"
        " the same as for identifiers that belong to nobody.",
        needs_ids=True,
    ),
    Attack(
        "an owner field in the query, a header and the body",
        "B adds A's account ID wherever a careless API might read one.",
    ),
    Attack(
        "an expired session token",
        "A token past its expiry, with everything else valid.",
    ),
    Attack(
        "no device signature",
        "A valid token alone, as a stolen token would be used.",
        needs_signed_route=True,
        covers_self_signed=True,
    ),
    Attack(
        "a replayed request",
        "A captured, validly signed request sent a second time.",
        needs_signed_route=True,
    ),
    Attack(
        "a revoked device",
        "A device of B's that B has removed.",
        needs_signed_route=True,
    ),
    Attack(
        "another account's device",
        "B's token with a request signed by A's device.",
        needs_signed_route=True,
    ),
)

# The one place where "not yours" and "does not exist" differ, and why that
# is accepted.
KNOWN_DIFFERENCES: dict[tuple[str, str], str] = {
    ("POST", "/v1/devices"): (
        "Device IDs are unique across all accounts, so registering an ID"
        " that is already in use is refused whoever owns it. A caller learns"
        " only that an ID they already hold is taken. IDs are random and are"
        " never shown to another account, and the caller must also prove"
        " knowledge of their own account's root key."
    ),
}

CASES: tuple[tuple[Operation, Attack], ...] = tuple(
    (operation, attack)
    for operation in OPERATIONS
    for attack in ATTACKS
    if attack.applies_to(operation)
)
