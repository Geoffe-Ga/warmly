"""Connection pool and owner-scoped transactions (ADR-0002).

Application code never touches a connection directly. It asks for a
transaction on behalf of one owner, and the database's row-level security
policies do the rest. Two things happen at the start of every such
transaction:

1. ``SET LOCAL ROLE warmly_api`` drops to a role that cannot bypass row-level
   security, whatever role the pool connected as.
2. ``warmly.owner_id`` is set to the verified owner for this transaction only.

So even a query that forgets its ``WHERE owner_id = ...`` clause can only see
and change that owner's rows (PRD SEC-006).
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from psycopg import AsyncConnection, Error
from psycopg.rows import TupleRow
from psycopg_pool import AsyncConnectionPool, PoolTimeout

PING_TIMEOUT_SECONDS = 2.0


class Database:
    """A pool of PostgreSQL connections for the API."""

    def __init__(self, url: str, *, max_size: int = 10) -> None:
        """Describe the pool without connecting.

        Args:
            url: PostgreSQL connection URL.
            max_size: Largest number of open connections.
        """
        self._pool: AsyncConnectionPool[AsyncConnection[TupleRow]] = (
            AsyncConnectionPool(url, min_size=1, max_size=max_size, open=False)
        )

    async def open(self) -> None:
        """Start the pool in the background.

        Does not wait for a connection: an unreachable database must not stop
        the API from starting. ``ping`` reports whether it is usable.
        """
        await self._pool.open(wait=False)

    async def close(self) -> None:
        """Close every connection."""
        await self._pool.close()

    async def ping(self) -> bool:
        """Check that a query can be run.

        Returns:
            ``True`` if the database answered within the timeout.
        """
        try:
            async with asyncio.timeout(PING_TIMEOUT_SECONDS):
                async with self._pool.connection(timeout=PING_TIMEOUT_SECONDS) as conn:
                    await conn.execute("SELECT 1")
        except (Error, PoolTimeout, TimeoutError, OSError):
            return False
        return True

    @asynccontextmanager
    async def as_owner(
        self, owner_id: UUID
    ) -> AsyncIterator[AsyncConnection[TupleRow]]:
        """Run one transaction on behalf of ``owner_id``.

        The transaction commits when the block exits normally and rolls back
        if it raises. The role and owner apply to this transaction only and
        are gone when the connection returns to the pool.

        Args:
            owner_id: The authenticated owner. It must come from the verified
                session, never from the request body.

        Yields:
            A connection confined to that owner's rows.
        """
        async with self._pool.connection() as conn, conn.transaction():
            await conn.execute("SET LOCAL ROLE warmly_api")
            await conn.execute(
                "SELECT set_config('warmly.owner_id', %s, true)", (str(owner_id),)
            )
            yield conn
