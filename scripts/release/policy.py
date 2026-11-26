"""The policy guard: does this pull request weaken the release policy?

PRD §10 says nobody may remove a failing test or weaken the security
policy just to get green CI. This script compares two copies of the
repository, the base of a pull request and its head, and reports every
change that weakens what `release/required-checks.yml` requires:

- a required check that is gone, runs in a different job, or has lost one
  of its paths;
- a file that is gone from under a required check's paths (a file that
  only moved, with the same contents, to somewhere still required is not
  counted);
- a protected number that is gone, cannot be found any more, or has moved
  the unsafe way (a coverage floor lowered, a size budget raised).

Any of these fails the pull request unless a person has put the
`release-policy-change` label on it. A label put on by a bot does not
count. A manifest that cannot be read fails whatever the labels say.

The script makes no network call and runs no other program. The workflow
checks out the two copies and saves the pull request's label history, and
hands all three over as paths.

Usage:
    python -m scripts.release.policy --base ../base --head . \
        --events label-events.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from scripts.release.gate import (
    Check,
    Manifest,
    ManifestError,
    Threshold,
    parse_manifest,
)

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

# Where the manifest lives in a copy of the repository.
MANIFEST_PATH = "release/required-checks.yml"
# The label that allows a pull request to weaken the policy.
POLICY_LABEL = "release-policy-change"
# Folders whose contents are made by tools, never part of a suite.
IGNORED_PARTS = frozenset({"__pycache__", "node_modules", ".pytest_cache"})


@dataclass(frozen=True)
class Violation:
    """One way a pull request weakens the release policy.

    Attributes:
        subject: The check, file or threshold concerned.
        problem: What happened to it, in plain words.
    """

    subject: str
    problem: str


def read_manifest(root: Path) -> Manifest | None:
    """Read the manifest of one copy of the repository.

    Args:
        root: The top of the copy.

    Returns:
        The manifest, or None when that copy has none.

    Raises:
        ManifestError: If the file is there and cannot be trusted.
    """
    path = root / MANIFEST_PATH
    if not path.is_file():
        return None
    return parse_manifest(path.read_text(encoding="utf-8"))


def files_under(root: Path, paths: Sequence[str]) -> Iterator[str]:
    """List every file under some paths of one copy of the repository.

    Args:
        root: The top of the copy.
        paths: Files or folders, relative to the top.

    Yields:
        Each file's path relative to the top, with forward slashes. Files
        made by tools (caches, compiled Python) are left out.
    """
    for each in paths:
        target = root / each
        found = [target] if target.is_file() else sorted(target.rglob("*"))
        for path in found:
            relative = path.relative_to(root)
            if (
                path.is_file()
                and path.suffix != ".pyc"
                and IGNORED_PARTS.isdisjoint(relative.parts)
            ):
                yield relative.as_posix()


def _digest(path: Path) -> str:
    """Hash a file's contents, to tell a moved file from a deleted one."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _required_paths(manifest: Manifest) -> list[str]:
    """List every path any required check names."""
    return [path for check in manifest.checks for path in check.paths]


def check_violations(base: Manifest, head: Manifest) -> list[Violation]:
    """Find required checks that were removed or weakened.

    Args:
        base: The manifest before the pull request.
        head: The manifest after it.

    Returns:
        One violation for each check that is gone, has moved to another
        job, or has lost a path.
    """
    after = {each.id: each for each in head.checks}
    found: list[Violation] = []
    for before in base.checks:
        now = after.get(before.id)
        if now is None:
            found.append(Violation(before.id, "this required check was removed"))
            continue
        found.extend(_weakened(before, now))
    return found


def _weakened(before: Check, now: Check) -> list[Violation]:
    """Find the ways one check is weaker than it was."""
    found: list[Violation] = []
    if now.job != before.job:
        found.append(
            Violation(
                before.id,
                f"its job changed from `{before.job}` to `{now.job}`",
            )
        )
    found.extend(
        Violation(before.id, f"it no longer covers `{path}`")
        for path in before.paths
        if path not in now.paths
    )
    return found


def deleted_files(
    base_root: Path, head_root: Path, base: Manifest, head: Manifest
) -> list[Violation]:
    """Find files that are gone from under a required check's paths.

    Args:
        base_root: The copy before the pull request.
        head_root: The copy after it.
        base: The manifest before.
        head: The manifest after.

    Returns:
        One violation for each file that was under a required path before
        and is not there now, unless a file with the same contents is
        under a required path now (it only moved).
    """
    kept = {
        _digest(head_root / each)
        for each in files_under(head_root, _required_paths(head))
    }
    found: list[Violation] = []
    for each in sorted(set(files_under(base_root, _required_paths(base)))):
        if (head_root / each).is_file():
            continue
        if _digest(base_root / each) in kept:
            continue
        found.append(Violation(each, "this file of a required suite was deleted"))
    return found


def read_number(root: Path, threshold: Threshold) -> int | None:
    """Read a protected number from one copy of the repository.

    Args:
        root: The top of the copy.
        threshold: Which number, and how to find it.

    Returns:
        The number, or None when the file is not there, the pattern does
        not match, or it matches more than one different number.
    """
    path = root / threshold.file
    if not path.is_file():
        return None
    values = {
        int(match.group(1))
        for match in re.finditer(threshold.pattern, path.read_text(encoding="utf-8"))
    }
    return values.pop() if len(values) == 1 else None


def _moved_unsafely(keep: str, before: int, now: int) -> bool:
    """Say whether a number moved against the direction it is kept in."""
    return now < before if keep == "at-least" else now > before


def threshold_violations(
    base_root: Path, head_root: Path, base: Manifest, head: Manifest
) -> list[Violation]:
    """Find protected numbers that were removed, lost or weakened.

    Args:
        base_root: The copy before the pull request.
        head_root: The copy after it.
        base: The manifest before.
        head: The manifest after.

    Returns:
        One violation for each threshold that is gone from the manifest,
        can no longer be read, or moved the unsafe way.
    """
    after = {each.id: each for each in head.thresholds}
    found: list[Violation] = []
    for before in base.thresholds:
        now = after.get(before.id)
        if now is None:
            found.append(Violation(before.id, "this threshold was removed"))
            continue
        old = read_number(base_root, before)
        new = read_number(head_root, now)
        if new is None:
            found.append(
                Violation(before.id, f"its number cannot be found in `{now.file}`")
            )
        elif old is not None and _moved_unsafely(before.keep, old, new):
            found.append(Violation(before.id, f"it was weakened from {old} to {new}"))
        if now.keep != before.keep:
            found.append(Violation(before.id, "its direction was changed"))
    return found


def violations(base_root: Path, head_root: Path) -> list[Violation]:
    """Find every way the head weakens the base's release policy.

    Args:
        base_root: The copy before the pull request.
        head_root: The copy after it.

    Returns:
        The violations. Empty when the base has no manifest yet: there is
        no policy to weaken.

    Raises:
        ManifestError: If either manifest cannot be trusted, or the head
            has none while the base has one.
    """
    base = read_manifest(base_root)
    if base is None:
        return []
    head = read_manifest(head_root)
    if head is None:
        message = "the manifest was deleted"
        raise ManifestError(message)
    return [
        *check_violations(base, head),
        *deleted_files(base_root, head_root, base, head),
        *threshold_violations(base_root, head_root, base, head),
    ]


def _concerns_label(event: Any) -> bool:
    """Say whether an event added or removed the policy label."""
    return (
        isinstance(event, dict)
        and event.get("event") in {"labeled", "unlabeled"}
        and isinstance(event.get("label"), dict)
        and event["label"].get("name") == POLICY_LABEL
    )


def _flat(events: list[Any]) -> Iterator[Any]:
    """Read a history saved as one list or as a list of pages."""
    # `gh api --paginate --slurp` saves a list of pages, each a list.
    for each in events:
        if isinstance(each, list):
            yield from each
        else:
            yield each


def approved_by_person(events: Any) -> bool:
    """Whether a person has put the policy label on the pull request.

    Args:
        events: The decoded JSON of the pull request's issue events
            (`GET /repos/{owner}/{repo}/issues/{number}/events`), oldest
            first, as GitHub returns them: one list, or a list of pages.

    Returns:
        True only when the last time the label was added or removed, it
        was added, by an account GitHub calls a `User`. Anything else,
        including data in a shape this does not know, is False.
    """
    if not isinstance(events, list):
        return False
    last = None
    for event in _flat(events):
        if _concerns_label(event):
            last = event
    if last is None or last.get("event") != "labeled":
        return False
    actor = last.get("actor")
    return isinstance(actor, dict) and actor.get("type") == "User"


def _read_events(path: Path | None) -> Any:
    """Read the saved label history; unreadable counts as none."""
    if path is None:
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def run(base_root: Path, head_root: Path, events_path: Path | None) -> tuple[int, str]:
    """Run the guard from two copies of the repository.

    Args:
        base_root: The copy before the pull request.
        head_root: The copy after it.
        events_path: The saved label history, if there is one. A file that
            cannot be read counts as no label.

    Returns:
        The exit code (0 when the pull request may go ahead) and what to
        print.
    """
    try:
        found = violations(base_root, head_root)
    except ManifestError as error:
        return 1, f"Release policy: BLOCKED. The manifest cannot be used: {error}"
    if not found:
        return 0, "Release policy: nothing is weakened."
    lines = [f"  - {each.subject}: {each.problem}" for each in found]
    if approved_by_person(_read_events(events_path)):
        heading = (
            f"Release policy: {len(found)} change(s) weaken the policy, and a "
            f"person has allowed them with the `{POLICY_LABEL}` label:"
        )
        return 0, "\n".join([heading, *lines])
    heading = (
        f"Release policy: BLOCKED. {len(found)} change(s) weaken the policy. "
        f"A person must put the `{POLICY_LABEL}` label on the pull request "
        "to allow them:"
    )
    return 1, "\n".join([heading, *lines])


def main(argv: Sequence[str] | None = None) -> int:
    """Run the guard from the command line.

    Args:
        argv: The arguments; the process's own by default.

    Returns:
        0 when the pull request may go ahead, 1 when it is blocked.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--head", type=Path, required=True)
    parser.add_argument("--events", type=Path, default=None)
    arguments = parser.parse_args(argv)
    code, message = run(arguments.base, arguments.head, arguments.events)
    sys.stdout.write(message + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
