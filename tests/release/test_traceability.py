"""The table of acceptance criteria and the tests that cite them (PRD §11).

The small repositories built here use made-up criteria numbered from 90,
so that this file does not itself count as a test of a real criterion.
"""

from pathlib import Path

import pytest

from scripts.release.traceability import (
    DOCUMENT_PATH,
    PRD_PATH,
    Criterion,
    build,
    citations,
    criteria,
    main,
    render,
    run,
    uncovered,
)

ROOT = Path(__file__).resolve().parents[2]

FIRST = "AC" + "-90"
SECOND = "AC" + "-91"
THIRD = "AC" + "-92"

PRD = f"""
## 11. Acceptance criteria

Each scenario must be represented in automated tests:

1. **[{FIRST}]** A person can sign up.
2. **[{SECOND}]** A person can write an entry offline.
3. **[{THIRD}]** Backups are kept for 30 days.

## 12. Something else

- [{FIRST}] is mentioned here again, which is not a definition.
"""

FILES = {
    PRD_PATH: PRD,
    "tests/api/test_accounts.py": f"def test_sign_up():\n    # {FIRST}\n    pass\n",
    "tests/api/helpers.py": f"# {THIRD} is named in a helper, which is not a test.\n",
    "tests/fixtures/notes.py": f"# {THIRD} in a fixture folder.\n",
    "tests/frontend/app/journal.test.tsx": (
        f'it("writes offline ({SECOND}, {FIRST})", () => {{}});\n'
        f'it("writes again ({SECOND})", () => {{}});\n'
    ),
    "tests/frontend/setup.ts": f"// {THIRD} in a set-up file.\n",
    "e2e/app/onboarding.spec.ts": f'test("signs up ({FIRST})", () => {{}});\n',
    "e2e/app/account.ts": f"// {THIRD} in a page helper.\n",
    "src/app/thing.ts": f"// {THIRD} in the app's own code.\n",
}


def repository(tmp_path: Path, files: dict[str, str] | None = None) -> Path:
    """Write a small repository and return its top."""
    for name, text in (FILES if files is None else files).items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return tmp_path


def test_the_criteria_are_read_from_the_numbered_list_in_the_prd() -> None:
    """Only the defining lines count, in order, with their text."""
    assert criteria(PRD) == [
        Criterion(FIRST, "A person can sign up."),
        Criterion(SECOND, "A person can write an entry offline."),
        Criterion(THIRD, "Backups are kept for 30 days."),
    ]


def test_only_test_files_count_and_each_is_filed_under_its_own_layer(
    tmp_path: Path,
) -> None:
    """Helpers, fixtures, set-up files and the app's own code are not tests."""
    found = citations(repository(tmp_path))

    assert found == {
        FIRST: {
            "Backend (pytest)": ["tests/api/test_accounts.py"],
            "Frontend (Vitest)": ["tests/frontend/app/journal.test.tsx"],
            "Browser (Playwright)": ["e2e/app/onboarding.spec.ts"],
        },
        SECOND: {"Frontend (Vitest)": ["tests/frontend/app/journal.test.tsx"]},
    }


def test_a_criterion_no_test_file_cites_is_named(tmp_path: Path) -> None:
    """The gap is reported, in the PRD's order."""
    document, gaps = build(repository(tmp_path))

    assert gaps == [THIRD]
    assert f"- Cited by none: 1 ({THIRD})" in document
    assert "**No test file cites this criterion.**" in document


def test_the_document_lists_each_criterion_with_its_files_by_layer(
    tmp_path: Path,
) -> None:
    """The table reads top to bottom as the PRD does."""
    document, _ = build(repository(tmp_path))

    start = document.index(f"## {FIRST}")
    end = document.index(f"## {SECOND}")
    assert document[start:end].splitlines() == [
        f"## {FIRST}",
        "",
        "A person can sign up.",
        "",
        "- Backend (pytest):",
        "  - `tests/api/test_accounts.py`",
        "- Frontend (Vitest):",
        "  - `tests/frontend/app/journal.test.tsx`",
        "- Browser (Playwright):",
        "  - `e2e/app/onboarding.spec.ts`",
        "",
    ]
    assert "- Criteria in the PRD: 3" in document
    assert "- Cited by at least one test file: 2" in document
    assert document.endswith("\n")
    assert not document.endswith("\n\n")


def test_the_document_says_what_it_does_not_show() -> None:
    """It claims that tests cite a criterion, not that they prove it."""
    document = render([Criterion(FIRST, "x")], {})

    assert "**What it\ndoes not show:** that the test is a sufficient test" in document


def test_nothing_uncovered_when_every_criterion_is_cited() -> None:
    """With no gaps the summary line carries no list."""
    listed = [Criterion(FIRST, "x")]
    cited = {FIRST: {"Backend (pytest)": ["tests/test_x.py"]}}

    assert not uncovered(listed, cited)
    assert "- Cited by none: 0\n" in render(listed, cited)


class TestRun:
    """The script's four jobs."""

    def test_write_then_check_agree(self, tmp_path: Path) -> None:
        """A document just written is up to date."""
        root = repository(tmp_path)

        assert run(root, "write") == (0, f"Wrote {DOCUMENT_PATH}.")
        assert run(root, "check") == (0, f"{DOCUMENT_PATH} is up to date.")

    def test_check_fails_when_a_test_starts_citing_a_criterion(
        self, tmp_path: Path
    ) -> None:
        """The document must be written again when the tests change."""
        root = repository(tmp_path)
        run(root, "write")
        (root / "tests/api/test_backups.py").write_text(
            f"def test_backups():\n    '''{THIRD}'''\n", encoding="utf-8"
        )

        code, message = run(root, "check")

        assert code == 1
        assert "python -m scripts.release.traceability --write" in message

    def test_check_fails_when_there_is_no_document(self, tmp_path: Path) -> None:
        """A missing document is an out-of-date one."""
        assert run(repository(tmp_path), "check")[0] == 1

    def test_require_all_fails_on_a_gap_and_names_it(self, tmp_path: Path) -> None:
        """This is the release's question, not a pull request's."""
        assert run(repository(tmp_path), "require-all") == (
            1,
            f"No test file cites: {THIRD}",
        )

    def test_require_all_passes_when_every_criterion_is_cited(
        self, tmp_path: Path
    ) -> None:
        """With a test for the last criterion, nothing is missing."""
        root = repository(tmp_path)
        (root / "tests/api/test_backups.py").write_text(
            f"def test_backups():\n    '''{THIRD}'''\n", encoding="utf-8"
        )

        assert run(root, "require-all")[0] == 0

    def test_print_shows_the_document_and_changes_nothing(self, tmp_path: Path) -> None:
        """Printing is the default and writes no file."""
        root = repository(tmp_path)

        code, message = run(root, "print")

        assert code == 0
        assert message.startswith("# Traceability: acceptance criteria to tests")
        assert not (root / DOCUMENT_PATH).exists()

    def test_the_command_line_runs_each_job(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """The flags map to the jobs, and the exit code is the job's."""
        root = str(repository(tmp_path))

        assert main(["--root", root]) == 0
        assert main(["--root", root, "--write"]) == 0
        assert main(["--root", root, "--check"]) == 0
        assert main(["--root", root, "--require-all"]) == 1
        assert f"No test file cites: {THIRD}" in capsys.readouterr().out


def test_the_committed_document_is_up_to_date() -> None:
    """The repository's own table matches its own tests and PRD."""
    code, message = run(ROOT, "check")

    assert code == 0, message


def test_the_prd_lists_twenty_eight_criteria() -> None:
    """If the PRD's list changes shape, this script must be looked at again."""
    listed = criteria((ROOT / PRD_PATH).read_text(encoding="utf-8"))

    assert [each.id for each in listed] == [f"AC-{n:02d}" for n in range(1, 29)]
