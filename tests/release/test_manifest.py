"""The repository's own manifest is sound (PRD §10, REL-001, REL-002).

The gate trusts `release/required-checks.yml`. These tests check that
what it names is real: every job is a job CI runs, every path holds
files, every threshold can be read, and the list covers what the PRD
requires.
"""

import re
from pathlib import Path

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


def test_no_required_job_can_be_skipped_by_a_condition(
    manifest: Manifest, workflow: dict[str, object]
) -> None:
    """A job with an `if:` can be skipped, and a skipped check blocks."""
    jobs = workflow["jobs"]
    assert isinstance(jobs, dict)
    required = {each.job for each in manifest.checks}

    conditional = [
        job["name"]
        for job in jobs.values()
        if "if" in job
        and job["name"].split(" (Python")[0]
        in {name.split(" (Python")[0] for name in required}
    ]

    assert not conditional


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
