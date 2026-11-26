"""A scan that could not run is a failure, never a pass (PRD §10, REL-002).

The secret scan and the static analysis are shell scripts round other
people's tools. These tests run the real scripts with the tools missing or
unusable and check that each says so and exits with 2, not 0.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SECRET_SCAN = ROOT / "scripts" / "release" / "secret-scan.sh"
SAST = ROOT / "scripts" / "release" / "sast.sh"
COULD_NOT_RUN = 2


def bare_path(tmp_path: Path, *tools: str) -> str:
    """A PATH holding only the shell's basics and the fake tools named.

    Each fake tool is a script that exits with 0, so a test can tell "the
    tool is missing" from "the tool was found but something else is wrong".
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("bash", "dirname", "sed", "find", "sort", "env"):
        found = shutil.which(name)
        assert found is not None, name
        (bin_dir / name).symlink_to(found)
    for name in tools:
        fake = bin_dir / name
        fake.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    return str(bin_dir)


def run(script: Path, path: str, **env: str) -> subprocess.CompletedProcess[str]:
    """Run one of the scan scripts with a given PATH and environment."""
    bash = shutil.which("bash")
    assert bash is not None
    return subprocess.run(
        [bash, str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={"PATH": path, "HOME": os.environ.get("HOME", "/")} | env,
        timeout=60,
    )


def test_the_secret_scan_fails_when_gitleaks_is_not_installed(tmp_path: Path) -> None:
    """No scanner means no scan, which must not look like a clean scan."""
    result = run(SECRET_SCAN, bare_path(tmp_path))

    assert result.returncode == COULD_NOT_RUN
    assert "could not run. gitleaks is not installed" in result.stderr
    assert "no secret found" not in result.stdout


def test_sast_fails_when_semgrep_is_not_installed(tmp_path: Path) -> None:
    """No analyser means no analysis."""
    result = run(SAST, bare_path(tmp_path), SEMGREP_RULES=str(tmp_path))

    assert result.returncode == COULD_NOT_RUN
    assert "could not run. semgrep is not installed" in result.stderr
    assert "no blocking finding" not in result.stdout


@pytest.mark.parametrize("rules", [None, "", "/nowhere/at/all"])
def test_sast_fails_when_it_is_not_given_the_rules(
    tmp_path: Path, rules: str | None
) -> None:
    """Semgrep with no rules would find nothing and look clean."""
    env = {} if rules is None else {"SEMGREP_RULES": rules}

    result = run(SAST, bare_path(tmp_path, "semgrep"), **env)

    assert result.returncode == COULD_NOT_RUN
    assert "SEMGREP_RULES must name a checkout of semgrep-rules" in result.stderr
    assert "no blocking finding" not in result.stdout


def test_sast_fails_when_the_rules_folder_holds_too_few_rules(tmp_path: Path) -> None:
    """A checkout that is empty or the wrong repository is not a rule set."""
    rules = tmp_path / "rules"
    for language in ("python", "javascript", "typescript"):
        (rules / language / "lang" / "security").mkdir(parents=True)

    result = run(SAST, bare_path(tmp_path, "semgrep"), SEMGREP_RULES=str(rules))

    assert result.returncode == COULD_NOT_RUN
    assert "Too few rule folders" in result.stderr
    assert "no blocking finding" not in result.stdout
