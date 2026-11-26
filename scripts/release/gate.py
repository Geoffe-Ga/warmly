"""The release gate: may this commit be released? (PRD §10; AC-24).

The gate reads two things:

- the manifest of required checks (`release/required-checks.yml`), and
- the check runs GitHub holds for one commit, as JSON saved from
  `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`.

It allows a release only when every required check is there, finished and
successful. Anything else blocks: a check that is missing, skipped,
cancelled, neutral, timed out, still running, or in a state this script
does not know. An unreadable manifest or results file blocks too.

The script makes no network call and runs no other program. The workflow
fetches the results and hands them over as a file, so the decision can be
tested with plain data.

Usage:
    python -m scripts.release.gate \
        --manifest release/required-checks.yml --results check-runs.json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping, Sequence

# The only state that lets a check pass.
SUCCESS = "success"
# The state of a required check GitHub has no result for.
MISSING = "missing"
# The state of a check that has not finished.
PENDING = "pending"
# The manifest format this script reads.
MANIFEST_VERSION = 1
# The two directions a protected number may be held in.
KEEP_CHOICES = ("at-least", "at-most")


class ManifestError(ValueError):
    """The manifest cannot be trusted as written."""


class ResultsError(TypeError):
    """The saved results are not the shape GitHub's check-runs response has."""


@dataclass(frozen=True)
class Check:
    """One required check.

    Attributes:
        id: The check's own short name, unique in the manifest.
        title: What the check proves, for people.
        job: The name of the CI job that runs it, as GitHub reports it.
        prd: The PRD IDs the check serves.
        paths: The test files and folders that make the check up, if any.
    """

    id: str
    title: str
    job: str
    prd: tuple[str, ...] = ()
    paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class Threshold:
    """A number the policy guard protects.

    Attributes:
        id: The threshold's own short name, unique in the manifest.
        file: The file that holds the number.
        pattern: A regular expression with one group, the number.
        keep: `at-least` for a floor, `at-most` for a ceiling.
    """

    id: str
    file: str
    pattern: str
    keep: str


@dataclass(frozen=True)
class Manifest:
    """Everything the manifest says.

    Attributes:
        checks: The required checks, in file order.
        thresholds: The protected numbers, in file order.
    """

    checks: tuple[Check, ...]
    thresholds: tuple[Threshold, ...] = ()


@dataclass(frozen=True)
class Blocked:
    """One required check that does not allow a release.

    Attributes:
        check: The check.
        state: What was found instead of success.
    """

    check: Check
    state: str


@dataclass(frozen=True)
class Decision:
    """The gate's answer.

    Attributes:
        allowed: Whether the commit may be released.
        blocked: Each check that stops it, in manifest order.
    """

    allowed: bool
    blocked: tuple[Blocked, ...] = field(default_factory=tuple)


def _text(entry: Mapping[str, Any], key: str, where: str) -> str:
    """Read a required non-empty string field of a manifest entry."""
    value = entry.get(key)
    if not isinstance(value, str) or not value.strip():
        message = f"{where}: `{key}` must be a non-empty string"
        raise ManifestError(message)
    return value


def _texts(entry: Mapping[str, Any], key: str, where: str) -> tuple[str, ...]:
    """Read an optional list of non-empty strings from a manifest entry."""
    value = entry.get(key, [])
    if not isinstance(value, list) or not all(
        isinstance(each, str) and each.strip() for each in value
    ):
        message = f"{where}: `{key}` must be a list of non-empty strings"
        raise ManifestError(message)
    return tuple(value)


def _entries(document: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    """Read a top-level list of entries from the manifest."""
    value = document.get(key, [])
    if not isinstance(value, list) or not all(isinstance(each, dict) for each in value):
        message = f"`{key}` must be a list of entries"
        raise ManifestError(message)
    return value


def _unique(ids: Iterable[str], kind: str) -> None:
    """Refuse a manifest that lists the same ID twice."""
    seen: set[str] = set()
    for each in ids:
        if each in seen:
            message = f"{kind} `{each}` is listed twice"
            raise ManifestError(message)
        seen.add(each)


def _check(entry: Mapping[str, Any], position: int) -> Check:
    """Build one required check from its manifest entry."""
    where = f"check {position}"
    return Check(
        id=_text(entry, "id", where),
        title=_text(entry, "title", where),
        job=_text(entry, "job", where),
        prd=_texts(entry, "prd", where),
        paths=_texts(entry, "paths", where),
    )


def _threshold(entry: Mapping[str, Any], position: int) -> Threshold:
    """Build one protected number from its manifest entry."""
    where = f"threshold {position}"
    keep = _text(entry, "keep", where)
    if keep not in KEEP_CHOICES:
        message = f"{where}: `keep` must be one of {', '.join(KEEP_CHOICES)}"
        raise ManifestError(message)
    return Threshold(
        id=_text(entry, "id", where),
        file=_text(entry, "file", where),
        pattern=_text(entry, "pattern", where),
        keep=keep,
    )


def parse_manifest(text: str) -> Manifest:
    """Read a manifest from its YAML text.

    Args:
        text: The contents of `release/required-checks.yml`.

    Returns:
        The manifest.

    Raises:
        ManifestError: If the text is not a manifest this script can trust:
            not YAML, the wrong version, no checks, a missing field or an
            ID listed twice.
    """
    try:
        document = yaml.safe_load(text)
    except yaml.YAMLError as error:
        message = "the manifest is not valid YAML"
        raise ManifestError(message) from error
    if not isinstance(document, dict):
        message = "the manifest must be a mapping"
        raise ManifestError(message)
    if document.get("version") != MANIFEST_VERSION:
        message = f"the manifest must say `version: {MANIFEST_VERSION}`"
        raise ManifestError(message)
    checks = tuple(
        _check(entry, position)
        for position, entry in enumerate(_entries(document, "checks"), start=1)
    )
    if not checks:
        message = "the manifest names no checks"
        raise ManifestError(message)
    thresholds = tuple(
        _threshold(entry, position)
        for position, entry in enumerate(_entries(document, "thresholds"), start=1)
    )
    _unique((each.id for each in checks), "check")
    _unique((each.id for each in thresholds), "threshold")
    return Manifest(checks=checks, thresholds=thresholds)


def _state_of(run: Mapping[str, Any]) -> str:
    """Give the state of one check run: pending until it has finished."""
    if run.get("status") != "completed":
        return PENDING
    conclusion = run.get("conclusion")
    return conclusion if isinstance(conclusion, str) and conclusion else "unknown"


def job_states(check_runs: Any) -> dict[str, str]:
    """Work out the state of each CI job from GitHub's check runs.

    A job that appears more than once (it was run again) is successful only
    if every one of its runs is: the worst state is kept.

    Args:
        check_runs: The decoded JSON of the check-runs response, or a list
            of such responses when it came in pages.

    Returns:
        The state of each job, by the job's name.

    Raises:
        ResultsError: If the data is not a check-runs response.
    """
    pages = check_runs if isinstance(check_runs, list) else [check_runs]
    states: dict[str, str] = {}
    for page in pages:
        runs = page.get("check_runs") if isinstance(page, dict) else None
        if not isinstance(runs, list):
            message = "the results are not a check-runs response"
            raise ResultsError(message)
        for run in runs:
            if not isinstance(run, dict) or not isinstance(run.get("name"), str):
                message = "a check run has no name"
                raise ResultsError(message)
            name = run["name"]
            state = _state_of(run)
            if states.get(name, SUCCESS) == SUCCESS:
                states[name] = state
    return states


def results_for(required: Sequence[Check], states: Mapping[str, str]) -> dict[str, str]:
    """Give each required check the state of the job that runs it.

    Args:
        required: The required checks.
        states: The state of each job, by job name.

    Returns:
        The state of each check, by check ID. A check whose job has no
        result is `missing`.
    """
    return {each.id: states.get(each.job, MISSING) for each in required}


def evaluate(required: Sequence[Check], results: Mapping[str, str]) -> Decision:
    """Decide whether a commit may be released (PRD §10; AC-24).

    Args:
        required: The required checks.
        results: The state of each check, by check ID.

    Returns:
        The decision. It allows a release only when there is at least one
        required check and every one of them is `success`. A check with no
        result counts as missing.
    """
    blocked = tuple(
        Blocked(check=each, state=results.get(each.id, MISSING))
        for each in required
        if results.get(each.id, MISSING) != SUCCESS
    )
    return Decision(allowed=bool(required) and not blocked, blocked=blocked)


def describe(decision: Decision, total: int) -> str:
    """Put a decision into words for the CI log.

    Args:
        decision: The decision.
        total: How many checks were required.

    Returns:
        The lines to print.
    """
    if decision.allowed:
        return f"Release gate: allowed. All {total} required checks passed."
    lines = [
        f"Release gate: BLOCKED. {len(decision.blocked)} of {total} "
        "required checks did not pass:"
    ]
    lines.extend(
        f"  - {each.check.id} ({each.check.job}): {each.state}"
        for each in decision.blocked
    )
    return "\n".join(lines)


def _saved_states(results_path: Path) -> dict[str, str] | str:
    """Read the saved results; give the reason as text if they cannot be used."""
    try:
        return job_states(json.loads(results_path.read_text(encoding="utf-8")))
    except (OSError, ValueError, ResultsError) as error:
        return str(error)


def run(manifest_path: Path, results_path: Path) -> tuple[int, str]:
    """Evaluate the gate from two files.

    Args:
        manifest_path: Where the manifest is.
        results_path: Where the saved check-runs JSON is.

    Returns:
        The exit code (0 only when the release is allowed) and what to
        print. Anything that cannot be read blocks.
    """
    try:
        manifest = parse_manifest(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ManifestError) as error:
        return 1, f"Release gate: BLOCKED. The manifest cannot be used: {error}"
    states = _saved_states(results_path)
    if isinstance(states, str):
        return 1, f"Release gate: BLOCKED. The results cannot be used: {states}"
    decision = evaluate(manifest.checks, results_for(manifest.checks, states))
    return (0 if decision.allowed else 1), describe(decision, len(manifest.checks))


def main(argv: Sequence[str] | None = None) -> int:
    """Run the gate from the command line.

    Args:
        argv: The arguments; the process's own by default.

    Returns:
        0 when the release is allowed, 1 when it is blocked.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    arguments = parser.parse_args(argv)
    code, message = run(arguments.manifest, arguments.results)
    sys.stdout.write(message + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
