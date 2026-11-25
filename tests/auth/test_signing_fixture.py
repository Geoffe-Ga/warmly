"""The server accepts what a browser signs (ADR-0005, D-06).

``tests/fixtures/signing/v1.json`` was produced with WebCrypto, the engine the
app signs with. The browser tests check the same file against the app's own
code, so the two sides cannot disagree about the signed message or the
signature's encoding without a test failing.
"""

import base64
import json
from operator import itemgetter
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest

from warmly.auth.device import (
    SIGNATURE_VERSION,
    SignedRequest,
    enrollment_proof_is_valid,
    signature_is_valid,
)

FIXTURE: dict[str, Any] = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "signing" / "v1.json").read_text()
)
REQUESTS: list[dict[str, Any]] = FIXTURE["requests"]


def signed(request: dict[str, Any], **overrides: Any) -> SignedRequest:
    """Build the request as the server would read it from the wire."""
    fields = {
        "method": request["method"],
        "target": request["target"],
        "body": base64.b64decode(request["body"]),
        "device_id": FIXTURE["deviceId"],
        "timestamp": str(request["timestamp"]),
        "nonce": request["nonce"],
        "signature": request["signature"],
    }
    return SignedRequest(**(fields | overrides))


def test_fixture_is_for_the_version_the_server_verifies() -> None:
    """Fixture is for the version the server verifies."""
    assert FIXTURE["signatureVersion"] == SIGNATURE_VERSION


@pytest.mark.parametrize("request_", REQUESTS, ids=itemgetter("name"))
def test_server_builds_the_same_message_the_browser_signed(
    request_: dict[str, Any],
) -> None:
    """Server builds the same message the browser signed."""
    assert signed(request_).message() == request_["message"].encode()


@pytest.mark.parametrize("request_", REQUESTS, ids=itemgetter("name"))
def test_server_accepts_a_browser_signature(request_: dict[str, Any]) -> None:
    """Server accepts a browser signature."""
    request = signed(request_)

    assert signature_is_valid(
        FIXTURE["publicKey"], request.message(), request.signature
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"method": "DELETE"},
        {"target": "/v1/devices/other"},
        {"body": b"tampered"},
        {"timestamp": "1"},
        {"nonce": "another-nonce-0000"},
        {"device_id": "d0000000-0000-4000-8000-0000000000f2"},
    ],
    ids=lambda o: next(iter(o)),
)
def test_changing_any_signed_part_invalidates_a_browser_signature(
    overrides: dict[str, Any],
) -> None:
    """Changing any signed part invalidates a browser signature."""
    request = signed(REQUESTS[1], **overrides)

    assert not signature_is_valid(
        FIXTURE["publicKey"], request.message(), request.signature
    )


def test_server_accepts_a_browser_enrollment_proof() -> None:
    """Server accepts a browser enrollment proof."""
    enrollment = FIXTURE["enrollment"]

    assert enrollment_proof_is_valid(
        enrollment["verifier"],
        UUID(FIXTURE["deviceId"]),
        FIXTURE["publicKey"],
        enrollment["proof"],
    )
