"""The database test setup when several test workers start at once.

Roles belong to the whole PostgreSQL cluster. Workers that start together
all try to create the same two roles, and the loser of that race is told
about it in one of two ways. Both must leave the worker able to carry on:
when one was missed, a whole worker's database tests failed at setup on an
unlucky run.
"""

import psycopg
import pytest
from psycopg import sql

from tests.db.conftest import BROWSER_ROLES, ensure_browser_roles


class _Cluster:
    """Stands in for a connection; fails role creation as it is told to."""

    def __init__(self, failure: type[Exception] | None) -> None:
        self.failure = failure
        self.attempted: list[str] = []

    def execute(self, statement: sql.Composed, /) -> None:
        """Record the role a statement creates, then fail if told to."""
        self.attempted.append(statement.as_string(None))
        if self.failure is not None:
            raise self.failure


def _roles(cluster: _Cluster) -> list[str]:
    """Return the roles the fixture tried to create, in order."""
    return [text.split('"')[1] for text in cluster.attempted]


@pytest.mark.parametrize(
    "failure",
    [
        None,
        psycopg.errors.DuplicateObject,
        psycopg.errors.UniqueViolation,
    ],
    ids=["roles are new", "roles already exist", "another worker is creating them"],
)
def test_every_browser_role_is_attempted_whatever_another_worker_did(
    failure: type[Exception] | None,
) -> None:
    """Losing the race for one role does not stop the next being created."""
    cluster = _Cluster(failure)

    ensure_browser_roles(cluster)

    assert _roles(cluster) == list(BROWSER_ROLES)


def test_any_other_database_error_still_fails_the_setup() -> None:
    """Only "the role exists" is tolerated; a real failure is not hidden."""
    cluster = _Cluster(psycopg.errors.InsufficientPrivilege)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        ensure_browser_roles(cluster)

    assert _roles(cluster) == [BROWSER_ROLES[0]]
