"""Signing keys: only asymmetric ones, cached, and fetched sparingly (SEC-006)."""

import http.client
import json
import threading
from collections.abc import Iterator, Sequence
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from tests.auth.tokens import Signer
from warmly.auth.keys import (
    JwksKeySource,
    KeysUnavailableError,
    StaticKeySource,
    _connection,
    fetch_key_set,
    parse_keys,
    remote_key_source,
)

pytestmark = pytest.mark.asyncio


class Clock:
    """A clock the test moves by hand."""

    def __init__(self) -> None:
        """Start at an arbitrary time."""
        self.now = 1000.0

    def __call__(self) -> float:
        """Return the current time."""
        return self.now


class Provider:
    """A stand-in for the auth provider's JWKS endpoint."""

    def __init__(self, *keys: dict[str, Any]) -> None:
        """Publish the given keys."""
        self.keys: Sequence[dict[str, Any]] = keys
        self.calls = 0
        self.failure: Exception | None = None

    async def __call__(self) -> Sequence[dict[str, Any]]:
        """Return the published keys, or fail as configured."""
        self.calls += 1
        if self.failure is not None:
            raise self.failure
        return self.keys


@pytest.fixture(scope="module")
def first() -> Signer:
    """Return the provider's first key."""
    return Signer(key_id="first")


@pytest.fixture(scope="module")
def second() -> Signer:
    """Return the key the provider rotates to."""
    return Signer(key_id="second")


async def test_parse_keeps_asymmetric_keys_by_id(first: Signer) -> None:
    """EC and RSA keys are both usable."""
    rsa = Signer(key_id="rsa", algorithm="RS256")

    keys = parse_keys([first.jwk(), rsa.jwk()])

    assert set(keys) == {"first", "rsa"}
    assert keys["first"].algorithm_name == "ES256"
    assert keys["rsa"].algorithm_name == "RS256"


@pytest.mark.parametrize(
    "jwk",
    [
        pytest.param(
            {"kty": "oct", "kid": "shared", "k": "c2VjcmV0", "alg": "HS256"},
            id="a shared secret",
        ),
        pytest.param({"kty": "EC", "crv": "P-256"}, id="no key id"),
        pytest.param({"kty": "EC", "kid": 7}, id="key id is not a string"),
        pytest.param({"kty": "EC", "kid": "broken", "crv": "P-256"}, id="malformed"),
        pytest.param({"kid": "untyped"}, id="no key type"),
        pytest.param(
            {"kty": "OKP", "kid": "ed", "crv": "Ed25519", "x": "AAAA"},
            id="an algorithm that is not allowed",
        ),
    ],
)
async def test_parse_skips_keys_it_must_not_trust(
    first: Signer, jwk: dict[str, Any]
) -> None:
    """A bad entry is dropped without spoiling the good one beside it."""
    assert set(parse_keys([jwk, first.jwk()])) == {"first"}


async def test_parse_skips_a_key_declared_for_another_algorithm(
    first: Signer,
) -> None:
    """An EC key labelled for a curve the API does not accept is not used."""
    relabelled = first.jwk() | {"alg": "ES512", "kid": "relabelled"}

    assert not parse_keys([relabelled])


async def test_static_source_returns_known_keys_only(first: Signer) -> None:
    """A fixed key set never grows."""
    source = StaticKeySource([first.jwk()])

    assert await source.key_for("first") is not None
    assert await source.key_for("second") is None


async def test_keys_are_fetched_once_and_then_cached(first: Signer) -> None:
    """Verifying many tokens does not mean many requests to the provider."""
    provider = Provider(first.jwk())
    source = JwksKeySource(provider, clock=Clock())

    for _ in range(5):
        assert await source.key_for("first") is not None

    assert provider.calls == 1


async def test_keys_are_fetched_again_after_the_ttl(first: Signer) -> None:
    """A key the provider has withdrawn stops working within the TTL."""
    clock = Clock()
    provider = Provider(first.jwk())
    source = JwksKeySource(provider, ttl_seconds=600, clock=clock)
    await source.key_for("first")

    clock.now += 599
    await source.key_for("first")
    assert provider.calls == 1

    clock.now += 2
    provider.keys = ()
    assert await source.key_for("first") is None
    assert provider.calls == 2


async def test_an_unknown_key_triggers_a_fetch_so_rotation_works(
    first: Signer, second: Signer
) -> None:
    """A token signed with a newly published key is accepted without a wait."""
    clock = Clock()
    provider = Provider(first.jwk())
    source = JwksKeySource(provider, min_refresh_seconds=30, clock=clock)
    await source.key_for("first")

    provider.keys = (first.jwk(), second.jwk())
    clock.now += 31

    assert await source.key_for("second") is not None
    assert provider.calls == 2


async def test_unknown_keys_cannot_make_the_api_hammer_the_provider(
    first: Signer,
) -> None:
    """Fetches are rate limited however many unknown key IDs arrive."""
    clock = Clock()
    provider = Provider(first.jwk())
    source = JwksKeySource(provider, min_refresh_seconds=30, clock=clock)
    await source.key_for("first")

    for attempt in range(20):
        assert await source.key_for(f"made-up-{attempt}") is None
    assert provider.calls == 1

    clock.now += 30
    assert await source.key_for("made-up-again") is None
    assert provider.calls == 2


@pytest.mark.parametrize(
    "failure",
    [OSError("refused"), TimeoutError(), ValueError("not json")],
    ids=["network error", "timeout", "bad document"],
)
async def test_a_failed_first_fetch_is_reported_as_unavailable(
    failure: Exception,
) -> None:
    """With nothing cached, a token cannot be judged either way."""
    provider = Provider()
    provider.failure = failure
    source = JwksKeySource(provider, clock=Clock())

    with pytest.raises(KeysUnavailableError):
        await source.key_for("first")


async def test_a_failed_fetch_is_retried_only_after_the_interval(
    first: Signer,
) -> None:
    """An outage does not turn every request into a slow outbound call."""
    clock = Clock()
    provider = Provider(first.jwk())
    provider.failure = OSError("down")
    source = JwksKeySource(provider, min_refresh_seconds=30, clock=clock)

    for _ in range(3):
        with pytest.raises(KeysUnavailableError):
            await source.key_for("first")
    assert provider.calls == 1

    provider.failure = None
    clock.now += 30
    assert await source.key_for("first") is not None
    assert provider.calls == 2


async def test_cached_keys_keep_working_when_a_refresh_fails(
    first: Signer,
) -> None:
    """A provider outage does not sign out people whose key is cached."""
    clock = Clock()
    provider = Provider(first.jwk())
    source = JwksKeySource(provider, ttl_seconds=600, clock=clock)
    await source.key_for("first")

    provider.failure = OSError("down")
    clock.now += 601

    assert await source.key_for("first") is not None
    with pytest.raises(KeysUnavailableError):
        await source.key_for("second")


async def test_an_unexpected_fetch_error_is_not_swallowed() -> None:
    """Only network and format failures mean 'unavailable'; bugs still surface."""
    provider = Provider()
    provider.failure = RuntimeError("bug")
    source = JwksKeySource(provider, clock=Clock())

    with pytest.raises(RuntimeError):
        await source.key_for("first")


class _Handler(BaseHTTPRequestHandler):
    """Serve whatever the test put on the server object."""

    def do_GET(self) -> None:
        """Answer with the configured status and body."""
        server: Any = self.server
        server.paths.append(self.path)
        self.send_response(server.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(server.body)))
        self.end_headers()
        self.wfile.write(server.body)

    def log_message(self, format: str, *args: Any) -> None:
        """Keep the test output quiet."""


@pytest.fixture
def endpoint() -> Iterator[Any]:
    """Run a loopback HTTP server standing in for the JWKS endpoint."""
    server: Any = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    server.status = 200
    server.body = b"{}"
    server.paths = []
    server.url = f"http://127.0.0.1:{server.server_port}/auth/v1/jwks.json"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()
    thread.join()


async def test_fetch_returns_the_keys_array(endpoint: Any, first: Signer) -> None:
    """The document's keys are returned and the path is requested as given."""
    endpoint.body = json.dumps({"keys": [first.jwk()]}).encode()

    assert fetch_key_set(endpoint.url) == [first.jwk()]
    assert endpoint.paths == ["/auth/v1/jwks.json"]


async def test_fetch_refuses_a_status_other_than_200(endpoint: Any) -> None:
    """A redirect or an error page is never parsed as keys."""
    endpoint.status = 302

    with pytest.raises(OSError, match="did not answer 200"):
        fetch_key_set(endpoint.url)


@pytest.mark.parametrize(
    "body",
    [b"[]", b'{"keys": "none"}', b'{"keys": [1]}', b"{}"],
    ids=["an array", "keys is a string", "a key is not an object", "no keys"],
)
async def test_fetch_refuses_a_document_without_a_keys_array(
    endpoint: Any, body: bytes
) -> None:
    """Anything that is not a key set is an error, not an empty key set."""
    endpoint.body = body

    with pytest.raises(ValueError, match="no keys array"):
        fetch_key_set(endpoint.url)


async def test_fetch_refuses_invalid_json(endpoint: Any) -> None:
    """A JSON error is a ValueError, which the key source treats as an outage."""
    endpoint.body = b"<html>"

    with pytest.raises(ValueError, match="Expecting value"):
        fetch_key_set(endpoint.url)


async def test_fetch_refuses_an_oversized_document(endpoint: Any) -> None:
    """The response size is capped."""
    endpoint.body = b" " * (256 * 1024 + 1)

    with pytest.raises(ValueError, match="too large"):
        fetch_key_set(endpoint.url)


async def test_fetch_reports_an_unreachable_endpoint_as_an_os_error(
    endpoint: Any,
) -> None:
    """A refused connection is the kind of error the key source expects."""
    url = endpoint.url
    endpoint.shutdown()
    endpoint.server_close()

    with pytest.raises(OSError, match=r".+"):
        fetch_key_set(url)


@pytest.mark.parametrize(
    "url", ["ftp://example.test/jwks", "file:///etc/passwd", "https:///jwks", "jwks"]
)
async def test_fetch_refuses_urls_that_are_not_http(url: str) -> None:
    """Only an http(s) URL with a host is ever requested."""
    with pytest.raises(ValueError, match="http"):
        fetch_key_set(url)


async def test_https_urls_get_a_verifying_tls_connection() -> None:
    """HTTPS uses the default context, which checks the certificate and host."""
    connection, path = _connection("https://auth.example.test/auth/v1/jwks.json")

    assert isinstance(connection, http.client.HTTPSConnection)
    assert connection.host == "auth.example.test"
    assert connection.port == 443
    assert path == "/auth/v1/jwks.json"


async def test_a_url_without_a_path_requests_the_root() -> None:
    """An empty path is sent as ``/``."""
    connection, path = _connection("http://127.0.0.1:9")

    assert not isinstance(connection, http.client.HTTPSConnection)
    assert path == "/"


async def test_remote_source_fetches_through_the_endpoint(
    endpoint: Any, first: Signer
) -> None:
    """The production key source wires the fetch and the cache together."""
    endpoint.body = json.dumps({"keys": [first.jwk()]}).encode()
    source = remote_key_source(endpoint.url)

    assert await source.key_for("first") is not None
    assert await source.key_for("first") is not None
    assert len(endpoint.paths) == 1
