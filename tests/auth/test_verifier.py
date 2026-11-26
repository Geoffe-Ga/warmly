"""Token verification fails closed (PRD §8, SEC-006; AC-05)."""

import base64
import hashlib
import hmac
import json
import time
from typing import Any
from uuid import UUID

import jwt
import pytest

from tests.auth.tokens import (
    AUDIENCE,
    ISSUER,
    OTHER_OWNER_ID,
    OWNER_ID,
    REMOVE,
    Signer,
)
from warmly.auth.keys import StaticKeySource
from warmly.auth.verifier import (
    LEEWAY_SECONDS,
    MAX_TOKEN_LENGTH,
    AuthenticationError,
    Owner,
    TokenVerifier,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture(scope="module")
def signer() -> Signer:
    """Return the key pair the verifier trusts."""
    return Signer()


@pytest.fixture
def verifier(signer: Signer) -> TokenVerifier:
    """Return a verifier that trusts ``signer``."""
    return TokenVerifier(
        issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
    )


async def _code(verifier: TokenVerifier, token: str) -> str:
    """Return the failure code for a token that must be refused."""
    with pytest.raises(AuthenticationError) as raised:
        await verifier.verify(token)
    return raised.value.code


async def test_a_valid_token_names_its_subject_as_the_owner(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """The owner is the token subject."""
    owner = await verifier.verify(signer.token())

    assert owner.id == UUID(OWNER_ID)


@pytest.mark.parametrize(
    ("amr", "expected"),
    [
        ([{"method": "password", "timestamp": 1_800_000_000}], 1_800_000_000),
        (
            [
                {"method": "password", "timestamp": 5},
                {"method": "password", "timestamp": 9},
                {"method": "otp", "timestamp": 99},
            ],
            9,
        ),
        (["password"], None),
        ([{"method": "otp", "timestamp": 5}], None),
        ([{"method": "password", "timestamp": True}], None),
        ([{"method": "password", "timestamp": "5"}], None),
        ("password", None),
        (None, None),
    ],
)
async def test_the_owner_carries_when_the_password_was_last_entered(
    verifier: TokenVerifier, signer: Signer, amr: object, expected: int | None
) -> None:
    """Only a timed password entry counts; anything else is "unknown"."""
    owner = await verifier.verify(signer.token(amr=amr))

    assert owner.password_entered_at == expected


async def test_a_token_without_the_claim_says_nothing_about_the_password(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """A token without the claim says nothing about the password."""
    owner = await verifier.verify(signer.token(amr=REMOVE))

    assert owner == Owner(id=UUID(OWNER_ID), password_entered_at=None)


async def test_the_owner_is_whoever_the_subject_names(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """A different subject is a different owner."""
    other = await verifier.verify(signer.token(sub=OTHER_OWNER_ID))

    assert other.id == UUID(OTHER_OWNER_ID)


async def test_an_rs256_token_is_accepted() -> None:
    """Both asymmetric algorithms the provider can use are supported."""
    signer = Signer(algorithm="RS256")
    verifier = TokenVerifier(
        issuer=ISSUER, audience=AUDIENCE, keys=StaticKeySource([signer.jwk()])
    )

    assert (await verifier.verify(signer.token())).id == UUID(OWNER_ID)


async def test_an_audience_list_that_includes_ours_is_accepted(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """``aud`` may be a list."""
    token = signer.token(aud=["other", AUDIENCE])

    assert (await verifier.verify(token)).id == UUID(OWNER_ID)


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param({"exp": int(time.time()) - LEEWAY_SECONDS - 5}, id="expired"),
        pytest.param({"iss": "https://evil.example.test/auth/v1"}, id="wrong issuer"),
        pytest.param({"iss": ISSUER + "/"}, id="issuer with a trailing slash"),
        pytest.param({"aud": "service_role"}, id="wrong audience"),
        pytest.param({"aud": []}, id="empty audience"),
        pytest.param({"exp": REMOVE}, id="no expiry"),
        pytest.param({"iat": REMOVE}, id="no issued-at"),
        pytest.param({"iss": REMOVE}, id="no issuer"),
        pytest.param({"aud": REMOVE}, id="no audience"),
        pytest.param({"sub": REMOVE}, id="no subject"),
        pytest.param({"sub": "not-a-uuid"}, id="subject is not a UUID"),
        pytest.param({"sub": ""}, id="empty subject"),
        pytest.param({"role": "anon"}, id="anonymous role"),
        pytest.param({"role": "service_role"}, id="service role"),
        pytest.param({"role": REMOVE}, id="no role"),
        pytest.param({"is_anonymous": True}, id="anonymous user"),
        pytest.param(
            {"iat": int(time.time()) + 3600, "nbf": int(time.time()) + 3600},
            id="not valid yet",
        ),
    ],
)
async def test_an_unacceptable_claim_is_refused(
    verifier: TokenVerifier, signer: Signer, claims: dict[str, Any]
) -> None:
    """Each standard claim is checked, and all fail with the same code."""
    assert await _code(verifier, signer.token(**claims)) == "auth.invalid_token"


async def test_a_token_within_the_clock_leeway_is_still_accepted(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """A few seconds of clock difference must not sign people out."""
    token = signer.token(exp=int(time.time()) - LEEWAY_SECONDS + 10)

    assert (await verifier.verify(token)).id == UUID(OWNER_ID)


@pytest.mark.parametrize(
    "metadata",
    [
        pytest.param({"email_verified": False}, id="false"),
        pytest.param({}, id="absent"),
        pytest.param({"email_verified": "true"}, id="a string, not a boolean"),
        pytest.param({"email_verified": 1}, id="a number, not a boolean"),
        pytest.param(REMOVE, id="no metadata at all"),
        pytest.param("email_verified", id="metadata is not an object"),
    ],
)
async def test_an_unverified_email_is_refused(
    verifier: TokenVerifier, signer: Signer, metadata: Any
) -> None:
    """Only an explicit boolean true counts as verified."""
    token = signer.token(user_metadata=metadata)

    assert await _code(verifier, token) == "auth.email_not_verified"


async def test_a_token_signed_by_another_key_is_refused(
    verifier: TokenVerifier,
) -> None:
    """Reusing a trusted key ID does not make a foreign signature valid."""
    impostor = Signer()

    assert await _code(verifier, impostor.token()) == "auth.invalid_token"


async def test_a_token_naming_an_unknown_key_is_refused(
    verifier: TokenVerifier,
) -> None:
    """A key the provider does not publish verifies nothing."""
    stranger = Signer(key_id="unknown-key")

    assert await _code(verifier, stranger.token()) == "auth.invalid_token"


async def test_a_token_without_a_key_id_is_refused(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """The verifier never guesses which key to try."""
    token = jwt.encode(
        {"sub": OWNER_ID}, signer.private_key, algorithm="ES256", headers={}
    )

    assert await _code(verifier, token) == "auth.invalid_token"


def _b64(data: dict[str, Any]) -> str:
    """Encode a JSON object as an unpadded base64url segment."""
    raw = json.dumps(data).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def test_a_tampered_payload_is_refused(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """Changing the subject after signing breaks the signature (AC-05)."""
    header, payload, signature = signer.token().split(".")
    padded = payload + "=" * (-len(payload) % 4)
    claims = json.loads(base64.urlsafe_b64decode(padded))
    claims["sub"] = OTHER_OWNER_ID

    forged = f"{header}.{_b64(claims)}.{signature}"

    assert await _code(verifier, forged) == "auth.invalid_token"


async def test_an_unsigned_token_is_refused(verifier: TokenVerifier) -> None:
    """``alg: none`` is never accepted, even with a trusted key ID."""
    header = _b64({"alg": "none", "typ": "JWT", "kid": "test-key-1"})
    payload = _b64({"sub": OWNER_ID, "iss": ISSUER, "aud": AUDIENCE})

    assert await _code(verifier, f"{header}.{payload}.") == "auth.invalid_token"


async def test_a_token_signed_with_the_public_key_as_a_secret_is_refused(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """The classic HS256 key-confusion attack fails: HS256 is not allowed."""
    # Built by hand: the JWT library refuses to make such a token itself.
    secret = json.dumps(signer.jwk()).encode()
    header = _b64({"alg": "HS256", "typ": "JWT", "kid": signer.key_id})
    payload = _b64({"sub": OWNER_ID, "iss": ISSUER, "aud": AUDIENCE})
    mac = hmac.new(secret, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    signature = base64.urlsafe_b64encode(mac).rstrip(b"=").decode()
    token = f"{header}.{payload}.{signature}"

    assert await _code(verifier, token) == "auth.invalid_token"


@pytest.mark.parametrize(
    "token",
    ["", "not-a-token", "a.b", "a.b.c", "....", "é.é.é", " "],
)
async def test_garbage_is_refused(verifier: TokenVerifier, token: str) -> None:
    """Malformed input never raises anything but the fixed failure."""
    assert await _code(verifier, token) == "auth.invalid_token"


async def test_an_oversized_token_is_refused_before_parsing(
    verifier: TokenVerifier, signer: Signer
) -> None:
    """A huge header value cannot make the server do work."""
    token = signer.token(padding="x" * MAX_TOKEN_LENGTH)

    assert await _code(verifier, token) == "auth.invalid_token"


async def test_a_failure_carries_only_its_code() -> None:
    """Nothing about the token is kept on the exception."""
    error = AuthenticationError("auth.invalid_token")

    assert str(error) == "auth.invalid_token"
    assert error.args == ("auth.invalid_token",)
