"""The migration runner applies each file once and refuses edited history."""

from pathlib import Path

import psycopg
import pytest

from warmly.config import Settings
from warmly.db import migrate
from warmly.db.migrate import (
    Migration,
    MigrationError,
    apply_migrations,
    discover,
)

pytestmark = pytest.mark.integration


def _applied_versions(url: str) -> list[str]:
    """Read the applied versions from the ledger."""
    with psycopg.connect(url) as conn:
        rows = conn.execute(
            "SELECT version FROM warmly_private.schema_migrations ORDER BY version"
        ).fetchall()
    return [version for (version,) in rows]


def test_every_repository_migration_is_applied(database_url: str) -> None:
    """The ledger lists exactly the files in supabase/migrations."""
    assert _applied_versions(database_url) == [m.version for m in discover()]
    assert discover()


def test_applying_again_is_a_no_op(database_url: str) -> None:
    """Re-running the migrator changes nothing (idempotent, PRD §7)."""
    with psycopg.connect(database_url) as conn:
        assert not apply_migrations(conn, discover())


def test_a_new_migration_is_applied_once_and_recorded(database_url: str) -> None:
    """Only the pending migration runs, and its checksum is stored."""
    extra = Migration(
        version="99990101000000",
        name="scratch",
        sql="CREATE TABLE warmly_private.scratch_once (id int)",
    )
    with psycopg.connect(database_url) as conn:
        try:
            assert apply_migrations(conn, [*discover(), extra]) == [extra.version]
            assert not apply_migrations(conn, [*discover(), extra])
            stored = conn.execute(
                "SELECT name, checksum FROM warmly_private.schema_migrations "
                "WHERE version = %s",
                (extra.version,),
            ).fetchone()
            assert stored == ("scratch", extra.checksum)
        finally:
            conn.rollback()
            conn.execute("DROP TABLE IF EXISTS warmly_private.scratch_once")
            conn.execute(
                "DELETE FROM warmly_private.schema_migrations WHERE version = %s",
                (extra.version,),
            )
            conn.commit()


def test_an_edited_migration_is_refused(database_url: str) -> None:
    """Changing a file after it ran is an error, not a silent re-run."""
    first = discover()[0]
    edited = Migration(first.version, first.name, first.sql + "\n-- edited")

    with (
        psycopg.connect(database_url) as conn,
        pytest.raises(MigrationError, match="changed after it was applied"),
    ):
        apply_migrations(conn, [edited])


def test_a_failing_migration_leaves_nothing_behind(database_url: str) -> None:
    """Each run is one transaction: a bad statement rolls everything back."""
    good = Migration(
        "99990101000001", "good", "CREATE TABLE warmly_private.half (id int)"
    )
    bad = Migration(
        "99990101000002", "bad", "SELECT * FROM warmly_private.no_such_table"
    )

    with psycopg.connect(database_url) as conn:
        with pytest.raises(psycopg.errors.UndefinedTable):
            apply_migrations(conn, [*discover(), good, bad])
        conn.rollback()
        exists = conn.execute("SELECT to_regclass('warmly_private.half')").fetchone()

    assert exists == (None,)
    assert good.version not in _applied_versions(database_url)


def test_discover_reads_files_in_version_order(tmp_path: Path) -> None:
    """Files are ordered by their version prefix."""
    (tmp_path / "20260102000000_second.sql").write_text("SELECT 2", encoding="utf-8")
    (tmp_path / "20260101000000_first.sql").write_text("SELECT 1", encoding="utf-8")

    found = discover(tmp_path)

    assert [(m.version, m.name, m.sql) for m in found] == [
        ("20260101000000", "first", "SELECT 1"),
        ("20260102000000", "second", "SELECT 2"),
    ]


@pytest.mark.parametrize("name", ["1_short.sql", "20260101000000-Dash.sql", "init.sql"])
def test_discover_rejects_badly_named_files(tmp_path: Path, name: str) -> None:
    """A misnamed file would otherwise be applied in an unintended order."""
    (tmp_path / name).write_text("SELECT 1", encoding="utf-8")

    with pytest.raises(MigrationError, match="file names must look like"):
        discover(tmp_path)


def test_main_applies_pending_migrations_to_the_configured_database(
    empty_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The command-line entry point migrates the database from the settings."""
    monkeypatch.setattr(
        migrate,
        "load_settings",
        lambda: Settings(environment="test", database_url=empty_database_url),
    )

    migrate.main()
    migrate.main()

    out = capsys.readouterr().out.splitlines()
    assert out[-1] == "Applied 0 migration(s): none"
    assert _applied_versions(empty_database_url) == [m.version for m in discover()]
