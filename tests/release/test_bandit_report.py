"""Bandit's report is read fail-closed (PRD §10, REL-002; AC-24)."""

import json
from pathlib import Path

import pytest

from scripts.release.bandit_report import judge, main, run


def finding(severity: str) -> dict[str, object]:
    """One Bandit finding of a given severity."""
    return {
        "issue_severity": severity,
        "test_id": "B602",
        "filename": "warmly/x.py",
        "line_number": 12,
    }


def report(*severities: str, errors: int = 0) -> dict[str, object]:
    """A Bandit report with these findings and this many unread files."""
    return {
        "results": [finding(each) for each in severities],
        "errors": [{"filename": f"bad{n}.py"} for n in range(errors)],
    }


def test_a_clean_report_passes() -> None:
    """A clean report passes."""
    assert judge(report()) == (0, "Bandit: no high-severity findings (0 lower ones).")


def test_low_and_medium_findings_do_not_block() -> None:
    """Low and medium findings do not block."""
    code, message = judge(report("LOW", "MEDIUM", "LOW"))

    assert code == 0
    assert "(3 lower ones)" in message


@pytest.mark.parametrize("severity", ["HIGH", "CRITICAL"])
def test_a_serious_finding_blocks_and_is_named(severity: str) -> None:
    """A serious finding blocks and is named."""
    code, message = judge(report("LOW", severity))

    assert code == 1
    assert message.splitlines() == [
        "Bandit: BLOCKED. 1 high-severity finding(s):",
        "  - B602 warmly/x.py:12",
    ]


def test_a_file_bandit_could_not_read_blocks() -> None:
    """A file bandit could not read blocks."""
    code, message = judge(report(errors=2))

    assert code == 1
    assert "could not read 2 file(s)" in message


@pytest.mark.parametrize(
    "data",
    [
        None,
        [],
        "text",
        {},
        {"results": []},
        {"errors": []},
        {"results": "none", "errors": []},
        {"results": [], "errors": None},
    ],
)
def test_something_that_is_not_a_bandit_report_blocks(data: object) -> None:
    """Something that is not a bandit report blocks."""
    assert judge(data) == (1, "Bandit: BLOCKED. The report is not a Bandit report.")


def test_a_finding_of_an_unknown_shape_blocks() -> None:
    """A finding of an unknown shape blocks."""
    code, message = judge({"results": ["text"], "errors": []})

    assert code == 1
    assert "a finding this script cannot read" in message


def test_a_missing_report_blocks(tmp_path: Path) -> None:
    """A missing report blocks."""
    assert run(tmp_path / "none.json") == (
        1,
        "Bandit: BLOCKED. There is no report that can be read.",
    )


@pytest.mark.parametrize("text", ["", "Traceback (most recent call last):"])
def test_a_report_that_is_not_json_blocks(tmp_path: Path, text: str) -> None:
    """A report that is not json blocks."""
    path = tmp_path / "report.json"
    path.write_text(text, encoding="utf-8")

    assert run(path)[0] == 1


def test_the_command_line_prints_the_result_and_returns_the_code(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The command line prints the result and returns the code."""
    path = tmp_path / "report.json"
    path.write_text(json.dumps(report("HIGH")), encoding="utf-8")

    assert main([str(path)]) == 1
    assert "BLOCKED" in capsys.readouterr().out

    path.write_text(json.dumps(report()), encoding="utf-8")

    assert main([str(path)]) == 0
