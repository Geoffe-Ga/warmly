"""The code owners file names an owner for the release gate's own files.

The Release Policy Guard cannot stop a pull request from editing the
workflow that runs it, or the manifest and scripts it reads (see "What the
guard cannot do" in `docs/runbooks/release-gates.md`). Review by a code
owner is what stops that, and it needs this file to say which paths.
"""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CODEOWNERS = ROOT / ".github" / "CODEOWNERS"
# The paths a change to the release gates could go through.
PROTECTED = ("/.github/workflows/", "/release/", "/scripts/release/")


def _rules() -> dict[str, list[str]]:
    """Read the file's rules: each path pattern and its owners."""
    rules: dict[str, list[str]] = {}
    for line in CODEOWNERS.read_text(encoding="utf-8").splitlines():
        text = line.split("#", maxsplit=1)[0].strip()
        if text:
            pattern, *owners = text.split()
            rules[pattern] = owners
    return rules


def test_the_file_is_where_github_reads_it() -> None:
    """GitHub reads code owners from `.github/CODEOWNERS`."""
    assert CODEOWNERS.is_file()


@pytest.mark.parametrize("path", PROTECTED)
def test_each_release_path_has_an_owner(path: str) -> None:
    """Every path the gates depend on is listed with at least one owner."""
    owners = _rules().get(path)

    assert owners, f"{path} has no code owner"
    assert all(owner.startswith("@") for owner in owners)


def test_the_file_owns_itself() -> None:
    """A change to who owns what is reviewed by an owner too."""
    assert _rules().get("/.github/CODEOWNERS")


@pytest.mark.parametrize("path", PROTECTED)
def test_each_listed_path_exists(path: str) -> None:
    """A rule for a path that is not there protects nothing."""
    assert (ROOT / path.strip("/")).is_dir()
