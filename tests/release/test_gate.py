"""The release gate fails closed (PRD §10, REL-002; AC-24).

`evaluate` is given plain data, so every way a check can fail to be a
success is tried here without GitHub.
"""

import json
from pathlib import Path

import pytest

from scripts.release.gate import (
    ACTIONS_APP,
    MISSING,
    PENDING,
    SUCCESS,
    Check,
    ManifestError,
    ResultsError,
    describe,
    evaluate,
    job_states,
    main,
    parse_manifest,
    results_for,
    run,
)

REQUIRED = (
    Check(id="python-tests", title="Backend tests", job="Quality (3.12)"),
    Check(id="isolation-suite", title="Isolation", job="Quality (3.12)"),
    Check(id="e2e", title="Browser tests", job="E2E"),
    Check(id="secret-scan", title="Secrets", job="Secret Scan"),
)

MANIFEST = """
version: 1
checks:
  - id: python-tests
    title: Backend tests
    job: Quality (3.12)
    prd: [REL-001]
    paths: [tests/api]
  - id: e2e
    title: Browser tests
    job: E2E
thresholds:
  - id: coverage
    file: pyproject.toml
    pattern: 'fail_under = (\\d+)'
    keep: at-least
"""


def all_green() -> dict[str, str]:
    """Every required check, successful."""
    return {each.id: SUCCESS for each in REQUIRED}


def check_run(
    name: str, conclusion: str | None, status: str | None = "completed"
) -> dict[str, object]:
    """One check run, shaped as GitHub reports it."""
    return {
        "name": name,
        "status": status,
        "conclusion": conclusion,
        "app": {"slug": ACTIONS_APP},
    }


def green_runs() -> dict[str, object]:
    """A check-runs response in which both jobs MANIFEST names passed."""
    return {
        "check_runs": [
            check_run("Quality (3.12)", "success"),
            check_run("E2E", "success"),
        ]
    }


class TestEvaluate:
    """The decision itself."""

    def test_allows_a_release_when_every_required_check_passed(self) -> None:
        """Allows a release when every required check passed."""
        decision = evaluate(REQUIRED, all_green())

        assert decision.allowed
        assert not decision.blocked

    @pytest.mark.parametrize(
        "state",
        [
            "missing",
            "skipped",
            "cancelled",
            "neutral",
            "failure",
            "timed_out",
            "action_required",
            "stale",
            "pending",
            "unknown",
            "",
            "SUCCESS",
        ],
    )
    def test_gate_fails_closed(self, state: str) -> None:
        """Gate fails closed."""
        results = all_green() | {"isolation-suite": state}

        decision = evaluate(REQUIRED, results)

        assert not decision.allowed
        assert [each.check.id for each in decision.blocked] == ["isolation-suite"]
        assert decision.blocked[0].state == state

    def test_a_check_with_no_result_at_all_blocks_as_missing(self) -> None:
        """A check with no result at all blocks as missing."""
        results = all_green()
        del results["secret-scan"]

        decision = evaluate(REQUIRED, results)

        assert not decision.allowed
        assert decision.blocked[0].check.id == "secret-scan"
        assert decision.blocked[0].state == MISSING

    def test_every_blocking_check_is_reported_in_manifest_order(self) -> None:
        """Every blocking check is reported in manifest order."""
        results = all_green() | {"e2e": "failure", "python-tests": "cancelled"}

        decision = evaluate(REQUIRED, results)

        assert [(each.check.id, each.state) for each in decision.blocked] == [
            ("python-tests", "cancelled"),
            ("e2e", "failure"),
        ]

    def test_nothing_required_is_not_a_pass(self) -> None:
        """Nothing required is not a pass."""
        assert not evaluate((), {}).allowed

    def test_a_result_for_a_check_nobody_requires_changes_nothing(self) -> None:
        """A result for a check nobody requires changes nothing."""
        results = all_green() | {"something-else": "failure"}

        assert evaluate(REQUIRED, results).allowed


class TestJobStates:
    """Reading GitHub's check runs."""

    def test_a_finished_run_has_its_conclusion(self) -> None:
        """A finished run has its conclusion."""
        states = job_states(
            {"check_runs": [check_run("E2E", "success"), check_run("Lint", "skipped")]}
        )

        assert states == {"E2E": "success", "Lint": "skipped"}

    @pytest.mark.parametrize("status", ["queued", "in_progress", "waiting", None])
    def test_a_run_that_has_not_finished_is_pending(self, status: str | None) -> None:
        """A run that has not finished is pending."""
        states = job_states({"check_runs": [check_run("E2E", None, status=status)]})

        assert states == {"E2E": PENDING}

    def test_a_run_still_going_is_pending_even_with_a_conclusion(self) -> None:
        """A run still going is pending even with a conclusion."""
        still_going = check_run("E2E", "success", status="in_progress")

        assert job_states({"check_runs": [still_going]}) == {"E2E": PENDING}

    @pytest.mark.parametrize("conclusion", [None, "", 7])
    def test_a_finished_run_with_no_conclusion_is_unknown(
        self, conclusion: object
    ) -> None:
        """A finished run with no conclusion is unknown."""
        finished = check_run("E2E", "success") | {"conclusion": conclusion}

        assert job_states({"check_runs": [finished]}) == {"E2E": "unknown"}

    @pytest.mark.parametrize(
        "runs",
        [
            [check_run("E2E", "failure"), check_run("E2E", "success")],
            [check_run("E2E", "success"), check_run("E2E", "failure")],
        ],
    )
    def test_a_job_run_twice_passes_only_if_both_runs_did(
        self, runs: list[dict[str, object]]
    ) -> None:
        """A job run twice passes only if both runs did."""
        assert job_states({"check_runs": runs}) == {"E2E": "failure"}

    @pytest.mark.parametrize(
        "app",
        [
            {"slug": "some-other-app"},
            {"slug": "GitHub-Actions"},
            {"slug": None},
            {},
            None,
            "github-actions",
        ],
    )
    def test_a_run_another_app_posted_under_the_same_name_does_not_count(
        self, app: object
    ) -> None:
        """Any app can post a check run called anything; only Actions' count."""
        forged = check_run("E2E", "success") | {"app": app}

        assert not job_states({"check_runs": [forged]})

    def test_a_run_with_no_app_at_all_does_not_count(self) -> None:
        """A run that does not say who posted it cannot be trusted."""
        unsigned = check_run("E2E", "success")
        del unsigned["app"]

        assert not job_states({"check_runs": [unsigned]})

    def test_another_apps_run_neither_passes_nor_fails_the_real_one(self) -> None:
        """The real job's own result stands, whatever a namesake says."""
        forged_pass = check_run("E2E", "success") | {"app": {"slug": "x"}}
        forged_fail = check_run("Lint", "failure") | {"app": {"slug": "x"}}
        runs = [
            forged_pass,
            check_run("E2E", "failure"),
            forged_fail,
            check_run("Lint", "success"),
        ]

        assert job_states({"check_runs": runs}) == {
            "E2E": "failure",
            "Lint": "success",
        }

    def test_pages_of_results_are_read_together(self) -> None:
        """Pages of results are read together."""
        pages = [
            {"check_runs": [check_run("E2E", "success")]},
            {"check_runs": [check_run("Lint", "success")]},
        ]

        assert job_states(pages) == {"E2E": "success", "Lint": "success"}

    @pytest.mark.parametrize(
        "data",
        [
            None,
            "text",
            {},
            {"check_runs": "none"},
            [{"check_runs": []}, "text"],
            {"check_runs": ["text"]},
            {"check_runs": [{"status": "completed", "conclusion": "success"}]},
            {"check_runs": [{"name": 3, "status": "completed"}]},
        ],
    )
    def test_data_of_the_wrong_shape_is_refused(self, data: object) -> None:
        """Data of the wrong shape is refused."""
        with pytest.raises(ResultsError):
            job_states(data)

    def test_no_runs_at_all_is_no_states(self) -> None:
        """No runs at all is no states."""
        assert not job_states({"check_runs": []})


class TestResultsFor:
    """Joining checks to jobs."""

    def test_each_check_takes_the_state_of_its_job(self) -> None:
        """Each check takes the state of its job."""
        results = results_for(REQUIRED, {"Quality (3.12)": "success", "E2E": "failure"})

        assert results == {
            "python-tests": "success",
            "isolation-suite": "success",
            "e2e": "failure",
            "secret-scan": MISSING,
        }

    def test_a_job_name_must_match_exactly(self) -> None:
        """A job name must match exactly."""
        results = results_for(REQUIRED, {"e2e": "success", "E2E ": "success"})

        assert results["e2e"] == MISSING


class TestParseManifest:
    """Reading the manifest."""

    def test_reads_checks_and_thresholds(self) -> None:
        """Reads checks and thresholds."""
        manifest = parse_manifest(MANIFEST)

        assert manifest.checks == (
            Check(
                id="python-tests",
                title="Backend tests",
                job="Quality (3.12)",
                prd=("REL-001",),
                paths=("tests/api",),
            ),
            Check(id="e2e", title="Browser tests", job="E2E"),
        )
        assert [each.id for each in manifest.thresholds] == ["coverage"]
        assert manifest.thresholds[0].keep == "at-least"
        assert manifest.thresholds[0].file == "pyproject.toml"

    @pytest.mark.parametrize(
        ("text", "reason"),
        [
            ("checks: [", "not valid YAML"),
            ("- a\n- b\n", "must be a mapping"),
            ("version: 2\nchecks: []\n", "version: 1"),
            ("checks:\n  - {id: a, title: A, job: J}\n", "version: 1"),
            ("version: 1\n", "names no checks"),
            ("version: 1\nchecks: []\n", "names no checks"),
            ("version: 1\nchecks: nope\n", "`checks` must be a list"),
            ("version: 1\nchecks: [text]\n", "`checks` must be a list"),
            ("version: 1\nchecks:\n  - {title: A, job: J}\n", "check 1: `id`"),
            ("version: 1\nchecks:\n  - {id: a, job: J}\n", "check 1: `title`"),
            ("version: 1\nchecks:\n  - {id: a, title: A}\n", "check 1: `job`"),
            (
                "version: 1\nchecks:\n  - {id: a, title: A, job: '  '}\n",
                "check 1: `job`",
            ),
            (
                "version: 1\nchecks:\n  - {id: a, title: A, job: J, paths: x}\n",
                "check 1: `paths`",
            ),
            (
                "version: 1\nchecks:\n  - {id: a, title: A, job: J, prd: [1]}\n",
                "check 1: `prd`",
            ),
            (
                "version: 1\nchecks:\n"
                "  - {id: a, title: A, job: J}\n"
                "  - {id: a, title: B, job: K}\n",
                "check `a` is listed twice",
            ),
            (
                "version: 1\nchecks:\n  - {id: a, title: A, job: J}\n"
                "thresholds:\n  - {id: t, file: f, pattern: p, keep: about}\n",
                "threshold 1: `keep` must be one of at-least, at-most",
            ),
            (
                "version: 1\nchecks:\n  - {id: a, title: A, job: J}\n"
                "thresholds:\n  - {id: t, file: f, keep: at-least}\n",
                "threshold 1: `pattern`",
            ),
            (
                "version: 1\nchecks:\n  - {id: a, title: A, job: J}\n"
                "thresholds:\n"
                "  - {id: t, file: f, pattern: p, keep: at-least}\n"
                "  - {id: t, file: g, pattern: q, keep: at-most}\n",
                "threshold `t` is listed twice",
            ),
        ],
    )
    def test_a_manifest_that_cannot_be_trusted_is_refused(
        self, text: str, reason: str
    ) -> None:
        """A manifest that cannot be trusted is refused."""
        with pytest.raises(ManifestError) as caught:
            parse_manifest(text)

        assert reason in str(caught.value)


class TestRun:
    """The gate as CI runs it, from two files."""

    def write(self, tmp_path: Path, results: object) -> tuple[Path, Path]:
        """Save a manifest and some results, and say where."""
        manifest = tmp_path / "required-checks.yml"
        manifest.write_text(MANIFEST, encoding="utf-8")
        saved = tmp_path / "check-runs.json"
        saved.write_text(json.dumps(results), encoding="utf-8")
        return manifest, saved

    def test_all_green_exits_zero_and_says_so(self, tmp_path: Path) -> None:
        """All green exits zero and says so."""
        manifest, saved = self.write(tmp_path, green_runs())

        code, message = run(manifest, saved)

        assert code == 0
        assert message == "Release gate: allowed. All 2 required checks passed."

    def test_a_skipped_job_exits_one_and_names_the_check(self, tmp_path: Path) -> None:
        """A skipped job exits one and names the check."""
        results = {
            "check_runs": [
                check_run("Quality (3.12)", "success"),
                check_run("E2E", "skipped"),
            ]
        }
        manifest, saved = self.write(tmp_path, results)

        code, message = run(manifest, saved)

        assert code == 1
        assert message.splitlines() == [
            "Release gate: BLOCKED. 1 of 2 required checks did not pass:",
            "  - e2e (E2E): skipped",
        ]

    def test_results_saved_by_gh_in_pages_are_read(self, tmp_path: Path) -> None:
        """`gh api --paginate --slurp` saves a list of whole responses.

        Each has GitHub's other fields too; only name, status and
        conclusion are read.
        """
        actions = {"id": 15368, "slug": "github-actions", "name": "GitHub Actions"}
        pages = [
            {
                "total_count": 3,
                "check_runs": [
                    {
                        "id": 1,
                        "name": "Quality (3.12)",
                        "status": "completed",
                        "conclusion": "success",
                        "app": actions,
                        "html_url": "https://example.invalid/1",
                        "started_at": "2026-11-26T14:16:42Z",
                        "completed_at": "2026-11-26T14:18:36Z",
                    },
                    {
                        "id": 2,
                        "name": "Release Gate",
                        "status": "in_progress",
                        "conclusion": None,
                        "app": actions,
                    },
                ],
            },
            {
                "total_count": 3,
                "check_runs": [
                    {
                        "id": 3,
                        "name": "E2E",
                        "status": "completed",
                        "conclusion": "success",
                        "app": actions,
                    }
                ],
            },
        ]
        manifest, saved = self.write(tmp_path, pages)

        code, message = run(manifest, saved)

        assert code == 0
        assert message == "Release gate: allowed. All 2 required checks passed."

    def test_no_results_file_blocks(self, tmp_path: Path) -> None:
        """No results file blocks."""
        manifest, saved = self.write(tmp_path, green_runs())
        saved.unlink()

        code, message = run(manifest, saved)

        assert code == 1
        assert message.startswith("Release gate: BLOCKED. The results cannot be used:")

    def test_results_that_are_not_json_block(self, tmp_path: Path) -> None:
        """Results that are not json block."""
        manifest, saved = self.write(tmp_path, green_runs())
        saved.write_text("<html>rate limited</html>", encoding="utf-8")

        code, message = run(manifest, saved)

        assert code == 1
        assert "The results cannot be used" in message

    def test_results_of_the_wrong_shape_block(self, tmp_path: Path) -> None:
        """Results of the wrong shape block."""
        manifest, saved = self.write(tmp_path, {"message": "Not Found"})

        code, message = run(manifest, saved)

        assert code == 1
        assert "not a check-runs response" in message

    def test_no_manifest_blocks(self, tmp_path: Path) -> None:
        """No manifest blocks."""
        manifest, saved = self.write(tmp_path, green_runs())
        manifest.unlink()

        code, message = run(manifest, saved)

        assert code == 1
        assert message.startswith("Release gate: BLOCKED. The manifest cannot be used:")

    def test_a_broken_manifest_blocks(self, tmp_path: Path) -> None:
        """A broken manifest blocks."""
        manifest, saved = self.write(tmp_path, green_runs())
        manifest.write_text("version: 1\nchecks: []\n", encoding="utf-8")

        code, message = run(manifest, saved)

        assert code == 1
        assert "names no checks" in message

    def test_the_command_line_prints_the_decision_and_returns_the_code(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """The command line prints the decision and returns the code."""
        manifest, saved = self.write(tmp_path, {"check_runs": []})

        code = main(["--manifest", str(manifest), "--results", str(saved)])

        assert code == 1
        printed = capsys.readouterr().out
        assert "BLOCKED. 2 of 2 required checks did not pass" in printed
        assert "  - python-tests (Quality (3.12)): missing" in printed

    def test_describe_says_how_many_passed_when_allowed(self) -> None:
        """Describe says how many passed when allowed."""
        decision = evaluate(REQUIRED, all_green())

        assert describe(decision, len(REQUIRED)) == (
            "Release gate: allowed. All 4 required checks passed."
        )
