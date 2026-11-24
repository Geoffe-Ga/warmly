"""Tests for scripts/python/analyze_mutations.py.

The script reads a mutmut SQLite cache. These tests build a small cache with
known contents and check the report, with and without the filename filter, so
the bound-parameter queries are shown to select the right rows.
"""

import importlib.util
import sqlite3
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = (
    Path(__file__).resolve().parents[2] / "scripts" / "python" / "analyze_mutations.py"
)

# The three mutmut cache tables the script reads.
SCHEMA = """
CREATE TABLE SourceFile (id INTEGER PRIMARY KEY, filename TEXT);
CREATE TABLE Line (id INTEGER PRIMARY KEY, sourcefile INTEGER, line_number INTEGER);
CREATE TABLE Mutant (id INTEGER PRIMARY KEY, line INTEGER, status TEXT);
"""

# (filename, status) for each mutant in the synthetic cache.
MUTANTS = [
    ("warmly/api/sync.py", "ok_killed"),
    ("warmly/api/sync.py", "ok_killed"),
    ("warmly/api/sync.py", "bad_survived"),
    ("warmly/api/devices.py", "bad_survived"),
    ("warmly/api/devices.py", "bad_survived"),
    ("warmly/api/devices.py", "bad_survived"),
    ("warmly/api/health.py", "untested"),
    ("warmly/api/100%_odd.py", "ok_killed"),
]


def load_script() -> ModuleType:
    """Import the script as a module without putting scripts/ on sys.path."""
    spec = importlib.util.spec_from_file_location("analyze_mutations", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def cache(tmp_path: Path) -> Path:
    """Create a mutmut-shaped cache holding MUTANTS."""
    path = tmp_path / ".mutmut-cache"
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    file_ids: dict[str, int] = {}
    for number, (filename, status) in enumerate(MUTANTS, start=1):
        if filename not in file_ids:
            file_ids[filename] = len(file_ids) + 1
            conn.execute(
                "INSERT INTO SourceFile (id, filename) VALUES (?, ?)",
                (file_ids[filename], filename),
            )
        conn.execute(
            "INSERT INTO Line (id, sourcefile, line_number) VALUES (?, ?, ?)",
            (number, file_ids[filename], number * 10),
        )
        conn.execute(
            "INSERT INTO Mutant (id, line, status) VALUES (?, ?, ?)",
            (number, number, status),
        )
    conn.commit()
    conn.close()
    return path


def test_unfiltered_report_counts_every_mutant(
    cache: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Without a filter the NULL pattern matches every file."""
    load_script().analyze_cache(cache)

    out = capsys.readouterr().out
    assert "Total mutants: 8" in out
    assert "  bad_survived: 4" in out
    assert "  ok_killed: 3" in out
    assert "  untested: 1" in out
    # 3 killed of 7 tested.
    assert "Mutation Score: 42.9%" in out


def test_filter_selects_only_paths_ending_with_the_name(
    cache: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The filename filter is a suffix match bound as a parameter."""
    load_script().analyze_cache(cache, filter_file="sync.py")

    out = capsys.readouterr().out
    assert "filtered: sync.py" in out
    assert "Total mutants: 3" in out
    assert "  bad_survived: 1" in out
    assert "  ok_killed: 2" in out
    assert "devices.py" not in out


def test_filter_value_is_data_not_sql(
    cache: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A hostile filter cannot change the query; it simply matches nothing."""
    load_script().analyze_cache(cache, filter_file="x' OR '1'='1")

    assert "Total mutants: 0" in capsys.readouterr().out


def test_top_limit_is_bound_and_orders_by_survivors(
    cache: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """LIMIT comes from the bound top_files value, worst file first."""
    load_script().analyze_cache(cache, top_files=1)

    out = capsys.readouterr().out
    section = out.split("=== Files with Most Survived Mutants (Top 1) ===")[1]
    listing = section.split("Sample of survived mutants")[0]
    assert "warmly/api/devices.py" in listing
    assert "warmly/api/sync.py" not in listing
    assert "3 ( 75.0%)" in listing


def test_missing_cache_exits_with_an_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A missing cache is reported on stderr with exit code 1."""
    with pytest.raises(SystemExit) as excinfo:
        load_script().analyze_cache(tmp_path / "absent")

    assert excinfo.value.code == 1
    assert "Cache file not found" in capsys.readouterr().err
