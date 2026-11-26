"""The policy guard (PRD §10, REL-002; AC-24).

A pull request may not remove a required check, delete a file of a
required suite or weaken a threshold, unless a person has put the
`release-policy-change` label on it. Each test builds two small copies of
a repository, a base and a head, and asks the guard about them.
"""

import json
from pathlib import Path

import pytest

from scripts.release.gate import ManifestError
from scripts.release.policy import (
    POLICY_LABEL,
    Violation,
    approved_by_person,
    files_under,
    main,
    run,
    violations,
)

MANIFEST = """
version: 1
checks:
  - id: isolation-suite
    title: Isolation
    job: Quality
    paths: [tests/security]
  - id: browser
    title: Browser tests
    job: E2E
    paths: [e2e/app/sync.spec.ts]
thresholds:
  - id: coverage
    file: pyproject.toml
    pattern: 'fail_under = (\\d+)'
    keep: at-least
  - id: download-kb
    file: budget.ts
    pattern: 'BUDGET = (\\d+)'
    keep: at-most
"""

FILES = {
    "release/required-checks.yml": MANIFEST,
    "tests/security/test_isolation.py": "def test_a(): ...\n",
    "tests/security/world.py": "WORLD = 1\n",
    "e2e/app/sync.spec.ts": "test('sync', () => {});\n",
    "pyproject.toml": "[tool.coverage.report]\nfail_under = 90\n",
    "budget.ts": "const BUDGET = 150;\n",
}


def unreadable(file: str) -> str:
    """What the guard says of a number it cannot read from a file."""
    return (
        f"its number cannot be read from `{file}`: it is missing, or given "
        "more than once with different values"
    )


def copy(root: Path, files: dict[str, str]) -> Path:
    """Write one copy of a small repository and return its top."""
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    root.mkdir(parents=True, exist_ok=True)
    return root


def pair(tmp_path: Path, head: dict[str, str]) -> tuple[Path, Path]:
    """Write a base copy of FILES and a head copy of something else."""
    return copy(tmp_path / "base", FILES), copy(tmp_path / "head", head)


def labelled(by: str, name: str = POLICY_LABEL) -> dict[str, object]:
    """A `labeled` event as GitHub reports it."""
    return {"event": "labeled", "label": {"name": name}, "actor": {"type": by}}


def unlabelled(by: str) -> dict[str, object]:
    """An `unlabeled` event for the policy label."""
    return {
        "event": "unlabeled",
        "label": {"name": POLICY_LABEL},
        "actor": {"type": by},
    }


class TestViolations:
    """What counts as weakening the policy."""

    def test_no_change_weakens_nothing(self, tmp_path: Path) -> None:
        """No change weakens nothing."""
        base, head = pair(tmp_path, FILES)

        assert not violations(base, head)

    def test_adding_a_check_a_test_and_a_threshold_weakens_nothing(
        self, tmp_path: Path
    ) -> None:
        """Adding a check a test and a threshold weakens nothing."""
        grown = MANIFEST.replace(
            "thresholds:",
            "  - id: new\n    title: New\n    job: New job\n"
            "    paths: [tests/new]\nthresholds:",
        )
        head = FILES | {
            "release/required-checks.yml": grown,
            "tests/new/test_new.py": "def test_n(): ...\n",
            "tests/security/test_more.py": "def test_m(): ...\n",
        }
        base, head_root = pair(tmp_path, head)

        assert not violations(base, head_root)

    def test_a_removed_check_is_a_violation(self, tmp_path: Path) -> None:
        """A removed check is a violation."""
        shrunk = MANIFEST.replace(
            "  - id: browser\n    title: Browser tests\n    job: E2E\n"
            "    paths: [e2e/app/sync.spec.ts]\n",
            "",
        )
        base, head = pair(tmp_path, FILES | {"release/required-checks.yml": shrunk})

        assert violations(base, head) == [
            Violation("browser", "this required check was removed")
        ]

    def test_a_check_moved_to_another_job_is_a_violation(self, tmp_path: Path) -> None:
        """A check moved to another job is a violation."""
        moved = MANIFEST.replace("job: E2E", "job: Lint")
        base, head = pair(tmp_path, FILES | {"release/required-checks.yml": moved})

        assert violations(base, head) == [
            Violation("browser", "its job changed from `E2E` to `Lint`")
        ]

    def test_a_check_that_lost_a_path_is_a_violation(self, tmp_path: Path) -> None:
        """A check that lost a path is a violation."""
        narrowed = MANIFEST.replace("paths: [tests/security]", "paths: []")
        base, head = pair(tmp_path, FILES | {"release/required-checks.yml": narrowed})

        assert violations(base, head) == [
            Violation("isolation-suite", "it no longer covers `tests/security`")
        ]

    def test_a_deleted_test_file_is_a_violation(self, tmp_path: Path) -> None:
        """A deleted test file is a violation."""
        head = FILES.copy()
        del head["tests/security/test_isolation.py"]
        base, head_root = pair(tmp_path, head)

        assert violations(base, head_root) == [
            Violation(
                "tests/security/test_isolation.py",
                "this file of a required suite was deleted",
            )
        ]

    def test_a_deleted_helper_of_a_suite_is_a_violation_too(
        self, tmp_path: Path
    ) -> None:
        """A deleted helper of a suite is a violation too."""
        head = FILES.copy()
        del head["tests/security/world.py"]
        base, head_root = pair(tmp_path, head)

        assert [each.subject for each in violations(base, head_root)] == [
            "tests/security/world.py"
        ]

    def test_a_deleted_file_named_directly_is_a_violation(self, tmp_path: Path) -> None:
        """A deleted file named directly is a violation."""
        head = FILES.copy()
        del head["e2e/app/sync.spec.ts"]
        base, head_root = pair(tmp_path, head)

        assert [each.subject for each in violations(base, head_root)] == [
            "e2e/app/sync.spec.ts"
        ]

    def test_a_file_moved_unchanged_within_required_paths_is_not_a_deletion(
        self, tmp_path: Path
    ) -> None:
        """A file moved unchanged within required paths is not a deletion."""
        head = FILES.copy()
        head["tests/security/attacks/test_isolation.py"] = head.pop(
            "tests/security/test_isolation.py"
        )
        base, head_root = pair(tmp_path, head)

        assert not violations(base, head_root)

    def test_a_file_moved_out_of_every_required_path_is_a_deletion(
        self, tmp_path: Path
    ) -> None:
        """A file moved out of every required path is a deletion."""
        head = FILES.copy()
        head["tests/elsewhere/test_isolation.py"] = head.pop(
            "tests/security/test_isolation.py"
        )
        base, head_root = pair(tmp_path, head)

        assert [each.subject for each in violations(base, head_root)] == [
            "tests/security/test_isolation.py"
        ]

    def test_a_file_emptied_and_moved_is_a_deletion(self, tmp_path: Path) -> None:
        """A file emptied and moved is a deletion."""
        head = FILES.copy()
        del head["tests/security/test_isolation.py"]
        head["tests/security/test_renamed.py"] = "\n"
        base, head_root = pair(tmp_path, head)

        assert [each.subject for each in violations(base, head_root)] == [
            "tests/security/test_isolation.py"
        ]

    def test_files_made_by_tools_are_not_part_of_a_suite(self, tmp_path: Path) -> None:
        """Files made by tools are not part of a suite."""
        base = copy(
            tmp_path / "base",
            FILES
            | {
                "tests/security/__pycache__/test_isolation.cpython-312.pyc": "x",
                "tests/security/.pytest_cache/README.md": "x",
                "tests/security/stray.pyc": "x",
            },
        )
        head = copy(tmp_path / "head", FILES)

        assert not violations(base, head)

    @pytest.mark.parametrize(
        ("file", "text", "problem"),
        [
            ("pyproject.toml", "fail_under = 89\n", "it was weakened from 90 to 89"),
            ("budget.ts", "const BUDGET = 151;\n", "it was weakened from 150 to 151"),
        ],
    )
    def test_a_number_moved_the_unsafe_way_is_a_violation(
        self, tmp_path: Path, file: str, text: str, problem: str
    ) -> None:
        """A number moved the unsafe way is a violation."""
        base, head = pair(tmp_path, FILES | {file: text})

        found = violations(base, head)

        assert [each.problem for each in found] == [problem]

    @pytest.mark.parametrize(
        ("file", "text"),
        [
            ("pyproject.toml", "fail_under = 95\n"),
            ("budget.ts", "const BUDGET = 120;\n"),
        ],
    )
    def test_a_number_moved_the_safe_way_is_fine(
        self, tmp_path: Path, file: str, text: str
    ) -> None:
        """A number moved the safe way is fine."""
        base, head = pair(tmp_path, FILES | {file: text})

        assert not violations(base, head)

    def test_a_number_that_can_no_longer_be_found_is_a_violation(
        self, tmp_path: Path
    ) -> None:
        """A number that can no longer be found is a violation."""
        base, head = pair(tmp_path, FILES | {"pyproject.toml": "[tool]\n"})

        assert violations(base, head) == [
            Violation("coverage", unreadable("pyproject.toml"))
        ]

    def test_a_number_whose_file_is_gone_is_a_violation(self, tmp_path: Path) -> None:
        """A number whose file is gone is a violation."""
        head = FILES.copy()
        del head["budget.ts"]
        base, head_root = pair(tmp_path, head)

        assert violations(base, head_root) == [
            Violation("download-kb", unreadable("budget.ts"))
        ]

    def test_two_different_numbers_for_one_threshold_cannot_be_trusted(
        self, tmp_path: Path
    ) -> None:
        """Two different numbers for one threshold cannot be trusted."""
        text = "fail_under = 90\nfail_under = 10\n"
        base, head = pair(tmp_path, FILES | {"pyproject.toml": text})

        assert [each.problem for each in violations(base, head)] == [
            unreadable("pyproject.toml")
        ]

    @pytest.mark.parametrize(
        "pattern",
        [
            "fail_under = (\\d+",
            "fail_under = \\d+",
            "(fail)_under = (\\d+)",
            "(fail)_under",
        ],
    )
    def test_a_pattern_that_cannot_give_one_number_is_a_violation(
        self, tmp_path: Path, pattern: str
    ) -> None:
        """A broken pattern, or one without exactly one number, reads nothing."""
        broken = MANIFEST.replace("fail_under = (\\d+)", pattern)
        base, head = pair(tmp_path, FILES | {"release/required-checks.yml": broken})

        assert violations(base, head) == [
            Violation("coverage", unreadable("pyproject.toml"))
        ]

    def test_a_removed_threshold_is_a_violation(self, tmp_path: Path) -> None:
        """A removed threshold is a violation."""
        shrunk = MANIFEST.replace(
            "  - id: download-kb\n    file: budget.ts\n"
            "    pattern: 'BUDGET = (\\d+)'\n    keep: at-most\n",
            "",
        )
        base, head = pair(tmp_path, FILES | {"release/required-checks.yml": shrunk})

        assert violations(base, head) == [
            Violation("download-kb", "this threshold was removed")
        ]

    def test_a_threshold_pointed_at_a_different_number_is_compared(
        self, tmp_path: Path
    ) -> None:
        """A threshold pointed at a different number is compared."""
        repointed = MANIFEST.replace("fail_under = (\\d+)", "other = (\\d+)")
        head = FILES | {
            "release/required-checks.yml": repointed,
            "pyproject.toml": "fail_under = 90\nother = 5\n",
        }
        base, head_root = pair(tmp_path, head)

        assert [each.problem for each in violations(base, head_root)] == [
            "it was weakened from 90 to 5"
        ]

    def test_a_threshold_whose_direction_was_flipped_is_a_violation(
        self, tmp_path: Path
    ) -> None:
        """A threshold whose direction was flipped is a violation."""
        flipped = MANIFEST.replace("keep: at-least", "keep: at-most")
        base, head = pair(tmp_path, FILES | {"release/required-checks.yml": flipped})

        assert violations(base, head) == [
            Violation("coverage", "its direction was changed")
        ]

    def test_a_base_with_no_manifest_has_no_policy_to_weaken(
        self, tmp_path: Path
    ) -> None:
        """A base with no manifest has no policy to weaken."""
        base = copy(tmp_path / "base", {"README.md": "x\n"})
        head = copy(tmp_path / "head", FILES)

        assert not violations(base, head)

    def test_a_deleted_manifest_is_refused(self, tmp_path: Path) -> None:
        """A deleted manifest is refused."""
        head = FILES.copy()
        del head["release/required-checks.yml"]
        base, head_root = pair(tmp_path, head)

        with pytest.raises(ManifestError, match="the manifest was deleted"):
            violations(base, head_root)

    def test_a_broken_manifest_is_refused(self, tmp_path: Path) -> None:
        """A broken manifest is refused."""
        base, head = pair(
            tmp_path, FILES | {"release/required-checks.yml": "version: 1\n"}
        )

        with pytest.raises(ManifestError, match="names no checks"):
            violations(base, head)


class TestFilesUnder:
    """Listing the files of a suite."""

    def test_lists_files_in_folders_and_files_named_directly(
        self, tmp_path: Path
    ) -> None:
        """Lists files in folders and files named directly."""
        root = copy(tmp_path / "repo", FILES)

        found = list(files_under(root, ["tests/security", "e2e/app/sync.spec.ts"]))

        assert found == [
            "tests/security/test_isolation.py",
            "tests/security/world.py",
            "e2e/app/sync.spec.ts",
        ]

    def test_a_path_that_is_not_there_lists_nothing(self, tmp_path: Path) -> None:
        """A path that is not there lists nothing."""
        root = copy(tmp_path / "repo", FILES)

        assert not list(files_under(root, ["tests/nowhere"]))


class TestApprovedByPerson:
    """Who may allow a weaker policy."""

    def test_a_label_put_on_by_a_person_counts(self) -> None:
        """A label put on by a person counts."""
        assert approved_by_person([labelled("User")])

    def test_a_label_put_on_by_a_bot_does_not_count(self) -> None:
        """A label put on by a bot does not count."""
        assert not approved_by_person([labelled("Bot")])

    def test_no_label_does_not_count(self) -> None:
        """No label does not count."""
        assert not approved_by_person([])

    def test_another_label_does_not_count(self) -> None:
        """Another label does not count."""
        assert not approved_by_person([labelled("User", name="bug")])

    def test_a_label_taken_off_again_does_not_count(self) -> None:
        """A label taken off again does not count."""
        events = [labelled("User"), unlabelled("User")]

        assert not approved_by_person(events)

    def test_a_bot_putting_the_label_back_after_a_person_does_not_count(
        self,
    ) -> None:
        """A bot putting the label back after a person does not count."""
        events = [labelled("User"), unlabelled("User"), labelled("Bot")]

        assert not approved_by_person(events)

    def test_a_history_saved_in_pages_is_read_in_order(self) -> None:
        """A history saved in pages is read in order."""
        pages = [[labelled("User")], [unlabelled("User")]]

        assert not approved_by_person(pages)
        assert approved_by_person([[labelled("Bot")], [labelled("User")]])

    def test_a_person_putting_it_back_after_a_bot_counts(self) -> None:
        """A person putting it back after a bot counts."""
        events = [labelled("Bot"), labelled("User")]

        assert approved_by_person(events)

    @pytest.mark.parametrize(
        "events",
        [
            None,
            {"event": "labeled"},
            ["labeled"],
            [{"event": "labeled", "label": POLICY_LABEL}],
            [{"event": "labeled", "label": {"name": POLICY_LABEL}}],
            [{"event": "labeled", "label": {"name": POLICY_LABEL}, "actor": "me"}],
            [{"event": "labeled", "label": {"name": POLICY_LABEL}, "actor": {}}],
        ],
    )
    def test_data_of_an_unknown_shape_does_not_count(self, events: object) -> None:
        """Data of an unknown shape does not count."""
        assert not approved_by_person(events)


class TestRun:
    """The guard as CI runs it."""

    def weakened(self, tmp_path: Path) -> tuple[Path, Path]:
        """A base, and a head with a lower coverage floor."""
        return pair(tmp_path, FILES | {"pyproject.toml": "fail_under = 80\n"})

    def events(self, tmp_path: Path, events: object) -> Path:
        """Save a label history and say where."""
        path = tmp_path / "events.json"
        path.write_text(json.dumps(events), encoding="utf-8")
        return path

    def test_nothing_weakened_passes(self, tmp_path: Path) -> None:
        """Nothing weakened passes."""
        base, head = pair(tmp_path, FILES)

        assert run(base, head, None) == (0, "Release policy: nothing is weakened.")

    def test_a_weakening_with_no_label_is_blocked(self, tmp_path: Path) -> None:
        """A weakening with no label is blocked."""
        base, head = self.weakened(tmp_path)

        code, message = run(base, head, None)

        assert code == 1
        assert message.splitlines() == [
            "Release policy: BLOCKED. 1 change(s) weaken the policy. A person "
            "must put the `release-policy-change` label on the pull request to "
            "allow them:",
            "  - coverage: it was weakened from 90 to 80",
        ]

    def test_a_weakening_a_person_labelled_passes_and_is_still_listed(
        self, tmp_path: Path
    ) -> None:
        """A weakening a person labelled passes and is still listed."""
        base, head = self.weakened(tmp_path)

        code, message = run(base, head, self.events(tmp_path, [labelled("User")]))

        assert code == 0
        assert "a person has allowed them" in message
        assert "  - coverage: it was weakened from 90 to 80" in message

    def test_a_weakening_a_bot_labelled_is_blocked(self, tmp_path: Path) -> None:
        """A weakening a bot labelled is blocked."""
        base, head = self.weakened(tmp_path)

        code, _ = run(base, head, self.events(tmp_path, [labelled("Bot")]))

        assert code == 1

    def test_a_label_history_that_cannot_be_read_counts_as_no_label(
        self, tmp_path: Path
    ) -> None:
        """A label history that cannot be read counts as no label."""
        base, head = self.weakened(tmp_path)
        broken = tmp_path / "events.json"
        broken.write_text("not json", encoding="utf-8")

        for path in (broken, tmp_path / "missing.json"):
            code, message = run(base, head, path)

            assert code == 1
            assert message.splitlines()[-1] == (
                "The pull request's label history could not be read, so no "
                "label was counted."
            )

    def test_a_readable_history_with_no_label_says_nothing_about_reading(
        self, tmp_path: Path
    ) -> None:
        """The note about an unreadable history appears only when it is one."""
        base, head = self.weakened(tmp_path)

        code, message = run(base, head, self.events(tmp_path, []))

        assert code == 1
        assert "could not be read" not in message

    def test_a_broken_manifest_is_blocked_whatever_the_label(
        self, tmp_path: Path
    ) -> None:
        """A broken manifest is blocked whatever the label."""
        base, head = pair(
            tmp_path, FILES | {"release/required-checks.yml": "version: 1\n"}
        )

        code, message = run(base, head, self.events(tmp_path, [labelled("User")]))

        assert code == 1
        assert message.startswith(
            "Release policy: BLOCKED. The manifest cannot be used:"
        )

    def test_the_command_line_prints_the_result_and_returns_the_code(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """The command line prints the result and returns the code."""
        base, head = self.weakened(tmp_path)
        events = self.events(tmp_path, [labelled("User")])

        blocked = main(["--base", str(base), "--head", str(head)])
        allowed = main(
            ["--base", str(base), "--head", str(head), "--events", str(events)]
        )

        assert (blocked, allowed) == (1, 0)
        assert "BLOCKED" in capsys.readouterr().out
