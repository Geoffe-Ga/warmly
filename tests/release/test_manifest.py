"""The repository's own manifest is sound (PRD §10, REL-001, REL-002).

The gate trusts `release/required-checks.yml`. These tests check that
what it names is real: every job is a job CI runs, every path holds
files, every threshold can be read, and the list covers what the PRD
requires.
"""

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

from scripts.release.gate import Manifest, parse_manifest
from scripts.release.policy import MANIFEST_PATH, files_under, read_number

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"

# What PRD §10 says must pass before a release, by the manifest's IDs.
REQUIRED_BY_THE_PRD = {
    "python-lint",
    "python-types",
    "python-tests",
    "frontend-lint-and-types",
    "frontend-tests",
    "e2e-and-accessibility",
    "isolation-suite",
    "crypto-fixture-compatibility",
    "recovery",
    "revocation",
    "sync-conflict-and-deletion",
    "indexeddb-migration",
    "source-invalidation",
    "dependency-scan",
    "frontend-dependency-scan",
    "secret-scan",
    "sast",
}


@pytest.fixture(scope="module")
def manifest() -> Manifest:
    """The repository's manifest."""
    return parse_manifest((ROOT / MANIFEST_PATH).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def workflow() -> dict[str, object]:
    """The CI workflow, decoded."""
    loaded = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def job_names(workflow: dict[str, object]) -> set[str]:
    """Every job name CI reports, with matrix values filled in."""
    jobs = workflow["jobs"]
    assert isinstance(jobs, dict)
    names: set[str] = set()
    for job in jobs.values():
        name = job["name"]
        matrix = job.get("strategy", {}).get("matrix", {})
        versions = matrix.get("python-version")
        if versions is None:
            names.add(name)
            continue
        names.update(
            name.replace("${{ matrix.python-version }}", str(each)) for each in versions
        )
    return names


def test_the_manifest_covers_everything_the_prd_requires(manifest: Manifest) -> None:
    """The manifest covers everything the prd requires."""
    listed = {each.id for each in manifest.checks}

    assert listed >= REQUIRED_BY_THE_PRD


def test_every_required_check_names_a_job_ci_runs(
    manifest: Manifest, workflow: dict[str, object]
) -> None:
    """Every required check names a job ci runs."""
    names = job_names(workflow)

    unknown = {each.id: each.job for each in manifest.checks if each.job not in names}

    assert not unknown


def required_jobs(
    manifest: Manifest, workflow: dict[str, object]
) -> dict[str, dict[str, Any]]:
    """The workflow's jobs that the manifest names, by job key."""
    jobs = workflow["jobs"]
    assert isinstance(jobs, dict)
    names = {each.job.split(" (Python")[0] for each in manifest.checks}
    return {
        key: job
        for key, job in jobs.items()
        if job["name"].split(" (Python")[0] in names
    }


def tolerates_failure(job_or_step: dict[str, Any]) -> bool:
    """Whether a job or step is told to carry on after failing.

    Anything but an absent or plainly false setting counts, including an
    expression, which cannot be judged here.
    """
    return job_or_step.get("continue-on-error", False) is not False


def test_no_required_job_can_be_skipped_or_allowed_to_fail(
    manifest: Manifest, workflow: dict[str, object]
) -> None:
    """A required job has no `if:` and no `continue-on-error`.

    A job with an `if:` can be skipped, which blocks every release. A job or
    step with `continue-on-error` reports success after failing, which would
    let a release through.
    """
    found = required_jobs(manifest, workflow)

    assert len(found) == 5
    assert not [key for key, job in found.items() if "if" in job]
    assert not [key for key, job in found.items() if tolerates_failure(job)]
    assert not [
        (key, step.get("name"))
        for key, job in found.items()
        for step in job["steps"]
        if tolerates_failure(step)
    ]


def test_the_gate_is_the_only_job_that_always_runs(
    manifest: Manifest, workflow: dict[str, object]
) -> None:
    """The gate must run after a failure, to report it. Nothing else may."""
    jobs = workflow["jobs"]
    assert isinstance(jobs, dict)

    always = [key for key, job in jobs.items() if "always()" in str(job.get("if", ""))]

    assert always == ["release-gate"]
    assert "release-gate" not in required_jobs(manifest, workflow)
    assert not tolerates_failure(jobs["release-gate"])


def test_the_gate_waits_for_every_job_the_manifest_names(
    manifest: Manifest, workflow: dict[str, object]
) -> None:
    """The gate waits for every job the manifest names."""
    jobs = workflow["jobs"]
    assert isinstance(jobs, dict)
    gate = jobs["release-gate"]
    waited_for = set()
    for key in gate["needs"]:
        name = jobs[key]["name"]
        waited_for.add(name.split(" (Python")[0])

    required = {each.job.split(" (Python")[0] for each in manifest.checks}

    assert required <= waited_for
    assert gate["if"] == "${{ always() }}"


def test_every_path_of_a_required_check_holds_files(manifest: Manifest) -> None:
    """Every path of a required check holds files."""
    empty = [
        (check.id, path)
        for check in manifest.checks
        for path in check.paths
        if not list(files_under(ROOT, [path]))
    ]

    assert not empty


def runner_of(path: str) -> str | None:
    """Which CI job runs the tests at a path; None for a shared fixture."""
    if path.startswith("tests/fixtures/"):
        return None
    if path.startswith("tests/frontend"):
        return "Frontend Quality (TypeScript)"
    if path.startswith("e2e/"):
        return "E2E + Accessibility (Playwright, axe-core)"
    if path.startswith("tests/"):
        return "Quality Checks (Python 3.12)"
    return "nothing this test knows"


def test_every_check_lists_only_files_its_own_job_runs(manifest: Manifest) -> None:
    """A check's job passing must mean that check's own files ran.

    Otherwise a failure in one of its files would show up against another
    job, and "the job passed, so the check passed" would be false.
    """
    misplaced = [
        (check.id, path, check.job)
        for check in manifest.checks
        for path in check.paths
        if runner_of(path) not in (None, check.job)
    ]

    assert not misplaced


def test_every_threshold_can_be_read_and_is_a_real_number(manifest: Manifest) -> None:
    """Every threshold can be read and is a real number."""
    values = {each.id: read_number(ROOT, each) for each in manifest.thresholds}

    assert None not in values.values()
    assert values["python-coverage"] == 90
    assert values["python-coverage-ci"] == 90
    assert values["python-branch-coverage-ci"] == 85
    assert values["frontend-branch-coverage"] == 85
    assert values["first-visit-download-kb"] == 150


def test_bandit_cannot_pass_by_writing_no_report() -> None:
    """The step after Bandit is the fail-closed reader, with no escape."""
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "python -m scripts.release.bandit_report bandit-report.json" in text
    assert "if [ -f bandit-report.json ]" not in text


def test_the_policy_workflow_pins_its_actions_and_reruns_on_a_label() -> None:
    """The policy workflow pins its actions and reruns on a label."""
    path = ROOT / ".github" / "workflows" / "release-policy.yml"
    text = path.read_text(encoding="utf-8")

    uses = re.findall(r"uses: (\S+)", text)

    assert uses
    assert all(re.fullmatch(r"[\w-]+/[\w-]+@[0-9a-f]{40}", each) for each in uses)
    assert "types: [opened, synchronize, reopened, labeled, unlabeled]" in text


def test_the_new_jobs_pin_their_actions_by_commit(workflow: dict[str, object]) -> None:
    """The new jobs pin their actions by commit."""
    jobs = workflow["jobs"]
    assert isinstance(jobs, dict)
    pinned = re.compile(r"^[\w-]+/[\w-]+@[0-9a-f]{40}$")

    loose = [
        (key, step["uses"])
        for key in ("secret-scan", "sast", "release-gate")
        for step in jobs[key]["steps"]
        if "uses" in step and not pinned.match(step["uses"])
    ]

    assert not loose
