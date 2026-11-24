"""Where the public keys that verify access tokens come from.

Only asymmetric keys are accepted. A shared secret would let anyone holding
it mint tokens, and the API has no reason to hold one.
"""

import asyncio
import http.client
import json
import ssl
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Protocol
from urllib.parse import urlsplit

from jwt import PyJWK
from jwt.exceptions import PyJWTError

# Signature algorithms the API accepts. Symmetric algorithms (HS256) and
# "none" are deliberately absent.
ALLOWED_ALGORITHMS: tuple[str, ...] = ("ES256", "RS256")
_ASYMMETRIC_KEY_TYPES = frozenset({"EC", "RSA"})

# How long fetched keys are trusted before they are fetched again. Matches the
# auth provider's own client.
KEY_TTL_SECONDS = 600.0
# The shortest gap between two fetches. A token naming an unknown key triggers
# a fetch, so without this floor anyone could make the API hammer the provider.
MIN_REFRESH_SECONDS = 30.0
_FETCH_TIMEOUT_SECONDS = 5.0
# A key set is a few hundred bytes per key. Refuse anything implausibly large.
_MAX_DOCUMENT_BYTES = 256 * 1024

Jwk = Mapping[str, object]
FetchKeys = Callable[[], Awaitable[Sequence[Jwk]]]


class KeysUnavailableError(Exception):
    """Raised when the signing keys cannot be fetched and none are cached."""


class KeySource(Protocol):
    """Looks up a verification key by its key ID."""

    async def key_for(self, key_id: str) -> PyJWK | None:
        """Return the key with this ID, or ``None`` if there is none."""


def parse_keys(jwks: Sequence[Jwk]) -> dict[str, PyJWK]:
    """Keep the usable asymmetric keys from a key set, by key ID.

    Entries that are symmetric, lack a key ID, name another algorithm or are
    malformed are skipped, not trusted and not fatal: one bad entry must not
    take down verification with the good ones.

    Args:
        jwks: The ``keys`` array of a JWKS document.

    Returns:
        The accepted keys, keyed by ``kid``.
    """
    keys: dict[str, PyJWK] = {}
    for jwk in jwks:
        key_id = jwk.get("kid")
        if not isinstance(key_id, str) or jwk.get("kty") not in _ASYMMETRIC_KEY_TYPES:
            continue
        try:
            key = PyJWK(dict(jwk))
        except PyJWTError:
            continue
        if key.algorithm_name in ALLOWED_ALGORITHMS:
            keys[key_id] = key
    return keys


class StaticKeySource:
    """A fixed set of keys. Used by tests and offline tools."""

    def __init__(self, jwks: Sequence[Jwk]) -> None:
        """Create the source.

        Args:
            jwks: The ``keys`` array of a JWKS document.
        """
        self._keys = parse_keys(jwks)

    async def key_for(self, key_id: str) -> PyJWK | None:
        """Return the key with this ID, or ``None`` if there is none.

        Args:
            key_id: The ``kid`` from a token header.

        Returns:
            The key, if known.
        """
        return self._keys.get(key_id)


class JwksKeySource:
    """Keys fetched from the auth provider and cached.

    Keys are fetched on first use, again once they are older than the TTL,
    and when a token names a key that is not cached (the provider may have
    rotated). Fetches are never closer together than the minimum interval.
    If a fetch fails, keys already cached keep working; a key that is not
    cached cannot be verified, and the failure is reported.
    """

    def __init__(
        self,
        fetch: FetchKeys,
        *,
        ttl_seconds: float = KEY_TTL_SECONDS,
        min_refresh_seconds: float = MIN_REFRESH_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Create the source.

        Args:
            fetch: Returns the provider's current key set.
            ttl_seconds: How long fetched keys are trusted.
            min_refresh_seconds: The shortest gap between two fetches.
            clock: A monotonic clock; tests pass their own.
        """
        self._fetch = fetch
        self._ttl = ttl_seconds
        self._min_refresh = min_refresh_seconds
        self._clock = clock
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._attempted_at: float | None = None
        self._last_attempt_failed = False
        self._lock = asyncio.Lock()

    def _is_fresh(self) -> bool:
        """Report whether the cached keys are within the TTL."""
        return (
            self._fetched_at is not None
            and self._clock() - self._fetched_at < self._ttl
        )

    def _may_fetch(self) -> bool:
        """Report whether enough time has passed since the last attempt."""
        return (
            self._attempted_at is None
            or self._clock() - self._attempted_at >= self._min_refresh
        )

    async def _refresh(self) -> None:
        """Fetch the key set, remembering whether it worked."""
        self._attempted_at = self._clock()
        try:
            self._keys = parse_keys(await self._fetch())
        except (OSError, ValueError):
            self._last_attempt_failed = True
            return
        self._last_attempt_failed = False
        self._fetched_at = self._clock()

    async def key_for(self, key_id: str) -> PyJWK | None:
        """Return the key with this ID, fetching the key set if needed.

        Args:
            key_id: The ``kid`` from a token header.

        Returns:
            The key, or ``None`` if the provider does not publish it.

        Raises:
            KeysUnavailableError: If the key is not cached and the key set
                could not be fetched.
        """
        async with self._lock:
            needs_fetch = not self._is_fresh() or key_id not in self._keys
            if needs_fetch and self._may_fetch():
                await self._refresh()
            key = self._keys.get(key_id)
            # "Not published" can only be said from a key set that was
            # actually fetched. After a failed fetch the honest answer for a
            # key that is not cached is "cannot tell".
            if key is None and self._last_attempt_failed:
                raise KeysUnavailableError
            return key


def _connection(url: str) -> tuple[http.client.HTTPConnection, str]:
    """Open the right kind of connection for a URL and return it with the path.

    Raises:
        ValueError: If the URL is not HTTP(S) or has no host.
    """
    parts = urlsplit(url)
    if not parts.hostname or parts.scheme not in {"http", "https"}:
        msg = "The key set URL must be an http(s) URL with a host"
        raise ValueError(msg)
    path = parts.path or "/"
    if parts.scheme == "https":
        return (
            http.client.HTTPSConnection(
                parts.hostname,
                parts.port,
                timeout=_FETCH_TIMEOUT_SECONDS,
                context=ssl.create_default_context(),
            ),
            path,
        )
    return (
        http.client.HTTPConnection(
            parts.hostname, parts.port, timeout=_FETCH_TIMEOUT_SECONDS
        ),
        path,
    )


def _get(url: str) -> tuple[int, bytes]:
    """Make one GET request and return the status and a capped body.

    One byte more than the cap is read, so the caller can tell "too large"
    from "exactly at the limit".
    """
    connection, path = _connection(url)
    try:
        connection.request("GET", path, headers={"Accept": "application/json"})
        response = connection.getresponse()
        return response.status, response.read(_MAX_DOCUMENT_BYTES + 1)
    finally:
        connection.close()


def fetch_key_set(url: str) -> Sequence[Jwk]:
    """Download and parse a JWKS document. Blocking; run it in a thread.

    Redirects are not followed, the response size is capped and the request
    times out, so a misbehaving endpoint cannot stall or exhaust the API.

    Args:
        url: The JWKS URL.

    Returns:
        The document's ``keys`` array.

    Raises:
        OSError: If the request fails or the status is not 200.
        ValueError: If the URL or the document is not what is expected.
    """
    status, body = _get(url)
    if status != http.client.OK:
        msg = "The key set endpoint did not answer 200"
        raise OSError(msg)
    if len(body) > _MAX_DOCUMENT_BYTES:
        msg = "The key set document is too large"
        raise ValueError(msg)
    document = json.loads(body)
    keys = document.get("keys") if isinstance(document, dict) else None
    if not isinstance(keys, list) or not all(isinstance(key, dict) for key in keys):
        msg = "The key set document has no keys array"
        raise ValueError(msg)
    return keys


def remote_key_source(url: str) -> JwksKeySource:
    """Build a key source that reads the auth provider's JWKS endpoint.

    Args:
        url: The JWKS URL.

    Returns:
        A caching key source. Nothing is fetched until the first token.
    """

    async def fetch() -> Sequence[Jwk]:
        """Run the blocking download off the event loop."""
        return await asyncio.to_thread(fetch_key_set, url)

    return JwksKeySource(fetch)
