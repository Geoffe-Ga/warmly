"""Apply SQL migrations in order, exactly once each.

Migrations are plain, forward-only SQL files in ``supabase/migrations``, named
``<version>_<name>.sql`` and applied in version order. Each runs in its own
transaction and is recorded with a checksum. A file that changes after it was
applied is an error: fix forward with a new migration instead (PRD §7, §10).

Run with ``python -m warmly.db.migrate`` using an administrative connection.
The API's own role cannot run migrations.
"""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from psycopg import Connection, connect
from psycopg.rows import TupleRow

from warmly.config import load_settings

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

_FILE_NAME = re.compile(r"^(?P<version>\d{14})_(?P<name>[a-z0-9_]+)\.sql$")

_ENSURE_LEDGER = """
CREATE SCHEMA IF NOT EXISTS warmly_private;
CREATE TABLE IF NOT EXISTS warmly_private.schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);
"""

_BAD_FILE_NAME = "Migration file names must look like 20260101000000_name.sql: {}"
_CHANGED_AFTER_APPLY = (
    "Migration {} was changed after it was applied. "
    "Restore it and add a new migration instead."
)


class MigrationError(RuntimeError):
    """Raised when the migration files and the database disagree."""


@dataclass(frozen=True)
class Migration:
    """One SQL file to apply."""

    version: str
    name: str
    sql: str

    @property
    def checksum(self) -> str:
        """SHA-256 of the file's text, used to detect later edits."""
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def discover(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    """Read every migration file, in version order.

    Args:
        directory: Folder holding the ``.sql`` files.

    Returns:
        The migrations, oldest first.

    Raises:
        MigrationError: If a file name does not follow the convention.
    """
    migrations = []
    for path in sorted(directory.glob("*.sql")):
        match = _FILE_NAME.match(path.name)
        if match is None:
            raise MigrationError(_BAD_FILE_NAME.format(path.name))
        migrations.append(
            Migration(
                version=match["version"],
                name=match["name"],
                sql=path.read_text(encoding="utf-8"),
            )
        )
    return migrations


def apply_migrations(
    conn: Connection[TupleRow], migrations: list[Migration]
) -> list[str]:
    """Apply the migrations that have not run yet.

    Args:
        conn: An administrative connection.
        migrations: Every known migration, oldest first.

    Returns:
        The versions applied by this call.

    Raises:
        MigrationError: If an already-applied migration's file has changed.
    """
    with conn.transaction():
        conn.execute(_ENSURE_LEDGER)
        # One migrator at a time, for the length of this transaction.
        conn.execute("LOCK TABLE warmly_private.schema_migrations IN EXCLUSIVE MODE")
        rows = conn.execute(
            "SELECT version, checksum FROM warmly_private.schema_migrations"
        ).fetchall()
        applied: dict[str, str] = dict(rows)
        newly_applied = []
        for migration in migrations:
            recorded = applied.get(migration.version)
            if recorded is None:
                # Migration text comes from a reviewed file in the repository,
                # never from user input; bytes is how psycopg takes such SQL.
                conn.execute(migration.sql.encode("utf-8"))
                conn.execute(
                    "INSERT INTO warmly_private.schema_migrations "
                    "(version, name, checksum) VALUES (%s, %s, %s)",
                    (migration.version, migration.name, migration.checksum),
                )
                newly_applied.append(migration.version)
            elif recorded != migration.checksum:
                raise MigrationError(_CHANGED_AFTER_APPLY.format(migration.version))
    return newly_applied


def main() -> None:
    """Apply pending migrations to the configured database."""
    settings = load_settings()
    with connect(settings.database_url) as conn:
        applied = apply_migrations(conn, discover())
    print(f"Applied {len(applied)} migration(s): {', '.join(applied) or 'none'}")


if __name__ == "__main__":
    main()
