"""Storage for request counters (PRD §8, SEC-005).

The counters are in PostgreSQL so a limit holds across every copy of the
API. Each query runs inside ``Database.as_owner``: an account can only count
against itself.
"""

from datetime import datetime
from uuid import UUID

from warmly.db.recovery_store import OwnerTransactions

# Counters from windows that have ended are of no further use. Removing them
# here keeps an account to a handful of rows however many device IDs its
# requests have named.
_FORGET_ENDED = """
    DELETE FROM warmly_private.rate_limits
     WHERE owner_id = %s
       AND window_start < %s
"""

# Add one to the counter, starting it again if it belonged to an earlier
# window. The row lock taken by the upsert makes concurrent requests count
# one after another, so none is lost. A request that arrives late, still
# carrying a window that has ended, changes nothing: the counter only ever
# moves forward in time.
_COUNT = """
    INSERT INTO warmly_private.rate_limits (owner_id, scope, window_start, count)
         VALUES (%s, %s, %s, 1)
    ON CONFLICT (owner_id, scope) DO UPDATE
            SET count = CASE
                    WHEN warmly_private.rate_limits.window_start
                         = EXCLUDED.window_start
                    THEN warmly_private.rate_limits.count + 1
                    WHEN warmly_private.rate_limits.window_start
                         > EXCLUDED.window_start
                    THEN warmly_private.rate_limits.count
                    ELSE 1
                END,
                window_start = GREATEST(
                    warmly_private.rate_limits.window_start,
                    EXCLUDED.window_start
                )
      RETURNING count
"""


class PostgresRateLimitStore:
    """The ``rate_limits`` table."""

    def __init__(self, database: OwnerTransactions) -> None:
        """Create the store.

        Args:
            database: Where owner-scoped transactions come from.
        """
        self._database = database

    async def count(
        self, owner_id: UUID, scopes: tuple[str, ...], window_start: datetime
    ) -> tuple[int, ...]:
        """Count one request against each scope and return the new totals.

        Args:
            owner_id: The verified owner.
            scopes: What the request counts against.
            window_start: When the current window began.

        Returns:
            The number of requests in this window for each scope, this one
            included, in the order the scopes were given.
        """
        totals: list[int] = []
        async with self._database.as_owner(owner_id) as tx:
            await tx.execute(_FORGET_ENDED, (owner_id, window_start))
            for scope in scopes:
                cursor = await tx.execute(_COUNT, (owner_id, scope, window_start))
                row = await cursor.fetchone()
                totals.append(row[0] if row else 1)
        return tuple(totals)
