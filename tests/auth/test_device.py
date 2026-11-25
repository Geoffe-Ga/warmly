"""The pieces of device verification, tested directly (ADR-0005, D-06)."""

import base64
from datetime import datetime
from uuid import UUID

import pytest
from starlette.requests import Request

from tests.auth.devices import (
    DEVICE_ID,
    ENROLLMENT_VERIFIER,
    TestDevice,
    enrollment_proof,
)
from tests.auth.tokens import OWNER_ID
from warmly.auth.device import (
    MAX_CLOCK_SKEW_SECONDS,
    DeviceAuthorizationError,
    DeviceVerifier,
    SignedRequest,
    decode_base64,
    enrollment_proof_is_valid,
    load_public_key,
    read_signed_request,
    signature_is_valid,
)
from warmly.auth.verifier import Owner

pytestmark = pytest.mark.asyncio

NOW = 1_800_000_000
OWNER = Owner(id=UUID(OWNER_ID))


class Devices:
    """A store with one device, recording every nonce it is asked to keep."""

    def __init__(self, device: TestDevice, *, revoked: bool = False) -> None:
        """Hold ``device`` for the test owner."""
        self.public_key = device.public_key
        self.revoked = revoked
        self.nonces: list[tuple[str, datetime]] = []

    async def find(self, owner_id: UUID, device_id: UUID) -> "Devices | None":
        """Return the device only for its own owner and ID."""
        return self if (owner_id, str(device_id)) == (OWNER.id, DEVICE_ID) else None

    async def use_nonce(
        self, owner_id: UUID, device_id: UUID, nonce: str, expires_at: datetime
    ) -> bool:
        """Accept each nonce once."""
        if nonce in [used for used, _ in self.nonces]:
            return False
        self.nonces.append((nonce, expires_at))
        return True


def _signed(device: TestDevice, **overrides: str) -> SignedRequest:
    """Build a correctly signed request, then apply overrides."""
    headers = device.headers("GET", "/v1/devices", timestamp=NOW, nonce="n" * 24)
    return SignedRequest(
        method=overrides.get("method", "GET"),
        target=overrides.get("target", "/v1/devices"),
        body=b"",
        device_id=overrides.get("device_id", headers["Warmly-Device"]),
        timestamp=overrides.get("timestamp", headers["Warmly-Timestamp"]),
        nonce=overrides.get("nonce", headers["Warmly-Nonce"]),
        signature=overrides.get("signature", headers["Warmly-Signature"]),
    )


async def test_the_signed_message_is_the_documented_one() -> None:
    """Seven lines: version, method, target, body hash, time, nonce, device."""
    signed = SignedRequest(
        method="post",
        target="/v1/x?y=1",
        body=b"{}",
        device_id=DEVICE_ID,
        timestamp="1800000000",
        nonce="abc",
        signature="",
    )

    assert signed.message() == (
        b"warmly-request-v1\nPOST\n/v1/x?y=1\n"
        b"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a\n"
        b"1800000000\nabc\n" + DEVICE_ID.encode()
    )


async def test_a_nonce_is_kept_until_its_timestamp_would_be_stale_anyway() -> None:
    """Keeping it for twice the skew covers a timestamp at either edge."""
    device = TestDevice()
    devices = Devices(device)
    verifier = DeviceVerifier(devices, clock=lambda: NOW)

    caller = await verifier.verify(OWNER, _signed(device))

    assert caller.device_id == UUID(DEVICE_ID)
    assert caller.owner == OWNER
    ((_, expires_at),) = devices.nonces
    assert int(expires_at.timestamp()) == NOW + 2 * MAX_CLOCK_SKEW_SECONDS


@pytest.mark.parametrize(
    "timestamp",
    [
        "",
        " 1",
        "1 ",
        "+5",
        "-5",
        "12.5",
        "1e9",
        "١٢٣",
        "0x10",
        "soon",
        "9" * 13,
        # Longer than Python will convert to a number at all.
        "9" * 5000,
    ],
    ids=lambda value: value if len(value) < 12 else f"{len(value)} digits",
)
async def test_only_ascii_digits_are_a_timestamp(timestamp: str) -> None:
    """Anything else is refused before it is turned into a number."""
    verifier = DeviceVerifier(Devices(TestDevice()), clock=lambda: NOW)

    with pytest.raises(DeviceAuthorizationError) as raised:
        verifier.check_timestamp(timestamp)

    assert raised.value.code == "device.stale_request"


async def test_a_timestamp_of_the_longest_allowed_length_is_read_as_a_number() -> None:
    """Twelve digits is a real, far-future time: stale, but not malformed."""
    far_future = 10**11
    verifier = DeviceVerifier(Devices(TestDevice()), clock=lambda: far_future)

    verifier.check_timestamp(str(far_future))


@pytest.mark.parametrize(
    ("offset", "accepted"),
    [
        (-MAX_CLOCK_SKEW_SECONDS, True),
        (MAX_CLOCK_SKEW_SECONDS, True),
        (-MAX_CLOCK_SKEW_SECONDS - 1, False),
        (MAX_CLOCK_SKEW_SECONDS + 1, False),
    ],
)
async def test_the_skew_limit_is_inclusive(offset: int, accepted: bool) -> None:
    """Exactly five minutes is allowed; one second more is not."""
    verifier = DeviceVerifier(Devices(TestDevice()), clock=lambda: NOW)

    if accepted:
        verifier.check_timestamp(str(NOW + offset))
    else:
        with pytest.raises(DeviceAuthorizationError):
            verifier.check_timestamp(str(NOW + offset))


@pytest.mark.parametrize("nonce", ["n" * 15, "n" * 65, "n" * 20 + "\n", "ñ" * 20])
async def test_a_nonce_must_be_16_to_64_printable_ascii_characters(nonce: str) -> None:
    """A nonce that could confuse the signed message is refused outright."""
    device = TestDevice()
    devices = Devices(device)

    with pytest.raises(DeviceAuthorizationError):
        await DeviceVerifier(devices, clock=lambda: NOW).verify(
            OWNER, _signed(device, nonce=nonce)
        )
    assert not devices.nonces


async def test_a_revoked_device_is_refused_without_recording_anything() -> None:
    """A revoked device cannot even use up nonces."""
    device = TestDevice()
    devices = Devices(device, revoked=True)

    with pytest.raises(DeviceAuthorizationError) as raised:
        await DeviceVerifier(devices, clock=lambda: NOW).verify(OWNER, _signed(device))

    assert raised.value.code == "device.not_authorized"
    assert not devices.nonces


async def test_a_failure_carries_only_its_code() -> None:
    """Nothing about the request is kept on the exception."""
    error = DeviceAuthorizationError("device.not_authorized")

    assert error.args == ("device.not_authorized",)


async def test_base64_must_be_strict_and_of_the_exact_length() -> None:
    """Padding, whitespace and length are all checked."""
    assert decode_base64("AAAA", 3) == b"\x00\x00\x00"
    assert decode_base64("AAAA", 4) is None
    assert decode_base64("AAA", 2) is None
    assert decode_base64("AA AA", 3) is None
    assert decode_base64("AAAA\n", 3) is None
    assert decode_base64("!!!!", 3) is None


async def test_a_public_key_must_be_an_uncompressed_point_on_the_curve() -> None:
    """A compressed point, the wrong length and an off-curve point are refused."""
    device = TestDevice()
    raw = base64.b64decode(device.public_key)
    compressed = base64.b64encode(b"\x02" + raw[1:33]).decode()

    assert load_public_key(device.public_key) is not None
    assert load_public_key(compressed) is None
    assert load_public_key(base64.b64encode(b"\x04" + b"\x00" * 64).decode()) is None
    assert load_public_key("not base64") is None


async def test_a_signature_is_checked_against_the_message_and_the_key() -> None:
    """Right key and message verify; anything else does not."""
    device = TestDevice()
    signed = _signed(device)

    assert signature_is_valid(device.public_key, signed.message(), signed.signature)
    assert not signature_is_valid(device.public_key, b"other", signed.signature)
    assert not signature_is_valid(
        TestDevice().public_key, signed.message(), signed.signature
    )
    assert not signature_is_valid("bm90IGEga2V5", signed.message(), signed.signature)
    assert not signature_is_valid(device.public_key, signed.message(), "AAAA")


async def test_the_enrollment_proof_binds_the_verifier_the_device_and_the_key() -> None:
    """Change any one of them and the proof no longer matches."""
    key = TestDevice().public_key
    device_id = UUID(DEVICE_ID)
    proof = enrollment_proof(DEVICE_ID, key)
    other_verifier = base64.b64encode(b"\x07" * 32).decode()

    assert enrollment_proof_is_valid(ENROLLMENT_VERIFIER, device_id, key, proof)
    assert not enrollment_proof_is_valid(other_verifier, device_id, key, proof)
    assert not enrollment_proof_is_valid(
        ENROLLMENT_VERIFIER, UUID(int=device_id.int + 1), key, proof
    )
    assert not enrollment_proof_is_valid(
        ENROLLMENT_VERIFIER, device_id, TestDevice().public_key, proof
    )
    assert not enrollment_proof_is_valid(ENROLLMENT_VERIFIER, device_id, key, "AAAA")
    assert not enrollment_proof_is_valid("c2hvcnQ=", device_id, key, proof)


def _request(raw_path: bytes, query: bytes) -> Request:
    """Build a request with all four signature headers and the given target."""
    headers = [
        (b"warmly-device", DEVICE_ID.encode()),
        (b"warmly-timestamp", b"1795651200"),
        (b"warmly-nonce", b"n" * 24),
        (b"warmly-signature", b"c2ln"),
    ]

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"", "more_body": False}

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/v1/devices",
        "raw_path": raw_path,
        "query_string": query,
        "headers": headers,
    }
    return Request(scope, receive)


async def test_the_signed_target_is_the_raw_path_and_query_as_sent() -> None:
    """Percent-encoding is kept as sent, so both sides sign the same text."""
    signed = await read_signed_request(_request(b"/v1/devices/a%2Fb", b"x=%FF&y=1"))

    assert signed.target == "/v1/devices/a%2Fb?x=%FF&y=1"
    assert (await read_signed_request(_request(b"/v1/devices", b""))).target == (
        "/v1/devices"
    )


@pytest.mark.parametrize(
    ("raw_path", "query"),
    [(b"/v1/devices", b"x=\xff"), (b"/v1/devices/\xc3\xa9", b""), (b"/\xff", b"\xff")],
    ids=["query", "path", "both"],
)
async def test_a_target_with_bytes_outside_ascii_is_refused_not_a_crash(
    raw_path: bytes, query: bytes
) -> None:
    """A raw non-ASCII byte cannot come from the app, and must not be a 500."""
    with pytest.raises(DeviceAuthorizationError) as refused:
        await read_signed_request(_request(raw_path, query))

    assert refused.value.code == "device.not_authorized"
