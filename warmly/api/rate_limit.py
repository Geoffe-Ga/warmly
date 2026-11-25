"""Per-account and per-device request limits (PRD §8, SEC-005; AC-20).

Every route that needs a signed-in caller counts each request against the
account and against the device the request names. Past the limit the answer
is ``429`` with ``Retry-After`` and nothing else is done. The limit is there
to bound what a stolen token or a runaway client can do; it is not a defence
against a flood of requests with no valid token, which never reach it and
belong to the hosting edge.

A request counts whether or not it goes on to succeed, so guessing at
signatures or identifiers uses up the same allowance.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Protocol
from uuid import UUID

from fastapi import Request

from warmly.api.errors import ProblemError
from warmly.auth.dependency import CurrentOwner

RATE_LIMITED_CODE = "rate.limited"
ACCOUNT_SCOPE = "account"
DEVICE_HEADER = "Warmly-Device"


@dataclass(frozen=True)
class RateLimits:
    """How many requests are allowed in each window."""

    per_account: int = 600
    per_device: int = 300
    window_seconds: int = 60


class RequestCounters(Protocol):
    """Where requests are counted."""

    async def count(
        self, owner_id: UUID, scopes: tuple[str, ...], window_start: datetime
    ) -> tuple[int, ...]:
        """Count one request against each scope and return the new totals."""


def device_scope(header: str | None) -> str | None:
    """Return the counter name for the device a request says it is from.

    The header is not yet verified when this runs. That is deliberate: a
    request with a bad signature still counts. Anything that is not a device
    ID counts against the account only.

    Args:
        header: The ``Warmly-Device`` header, if the request has one.

    Returns:
        The scope, or ``None`` if the header does not hold a device ID.
    """
    if header is None:
        return None
    try:
        return f"device:{UUID(header)}"
    except ValueError:
        return None


class RateLimiter:
    """Counts requests and says when an account or device has made too many."""

    def __init__(
        self, counters: RequestCounters, limits: RateLimits, clock: "Clock"
    ) -> None:
        """Create the limiter.

        Args:
            counters: Where requests are counted.
            limits: How many are allowed.
            clock: Seconds since the epoch.
        """
        self._counters = counters
        self._limits = limits
        self._clock = clock

    async def check(self, owner_id: UUID, device_header: str | None) -> None:
        """Count a request, and refuse it if it is one too many.

        Args:
            owner_id: The verified owner.
            device_header: The device the request says it is from.

        Raises:
            ProblemError: 429 with ``Retry-After`` when over a limit.
        """
        now = self._clock()
        window = self._limits.window_seconds
        # Fixed windows: a burst that straddles a boundary can reach about
        # twice the limit. That is acceptable for limits this generous.
        started = now - now % window
        device = device_scope(device_header)
        scopes = (ACCOUNT_SCOPE,) if device is None else (ACCOUNT_SCOPE, device)
        allowed = (self._limits.per_account, self._limits.per_device)
        totals = await self._counters.count(
            owner_id, scopes, datetime.fromtimestamp(started, tz=UTC)
        )
        if any(total > limit for total, limit in zip(totals, allowed, strict=False)):
            wait = max(1, int(started + window - now) + 1)
            raise ProblemError(
                HTTPStatus.TOO_MANY_REQUESTS,
                RATE_LIMITED_CODE,
                headers={"Retry-After": str(wait)},
            )


class Clock(Protocol):
    """Returns the time in seconds since the epoch."""

    def __call__(self) -> float:
        """Return the current time."""


async def limit_requests(request: Request, owner: CurrentOwner) -> None:
    """Count this request against its account and device.

    Args:
        request: The current request; its application holds the limiter.
        owner: The verified account.
    """
    limiter: RateLimiter = request.app.state.rate_limiter
    await limiter.check(owner.id, request.headers.get(DEVICE_HEADER))
