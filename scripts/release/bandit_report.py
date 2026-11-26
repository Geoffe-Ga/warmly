"""Read Bandit's report and fail closed (PRD §10, REL-002; AC-24).

Bandit exits with 1 when it finds anything at all, low severity included,
so CI cannot use its exit code to block only on serious findings. CI lets
Bandit write a JSON report and then asks this script. The answer is "pass"
only when the report is there, is a Bandit report, lists no file Bandit
failed to read, and holds no finding of high severity.

A missing or unreadable report is a failure: no result is not a clean
result.

Usage:
    python -m scripts.release.bandit_report bandit-report.json
"""

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

# The severities that block. Bandit's scale stops at HIGH; CRITICAL is
# listed so a later version that adds it blocks too.
BLOCKING = frozenset({"HIGH", "CRITICAL"})


def judge(report: Any) -> tuple[int, str]:
    """Decide whether a Bandit report lets the build go on.

    Args:
        report: The decoded JSON of Bandit's report.

    Returns:
        The exit code (0 to go on) and what to print.
    """
    if not isinstance(report, dict):
        return 1, "Bandit: BLOCKED. The report is not a Bandit report."
    results = report.get("results")
    errors = report.get("errors")
    if not isinstance(results, list) or not isinstance(errors, list):
        return 1, "Bandit: BLOCKED. The report is not a Bandit report."
    if errors:
        return 1, (
            f"Bandit: BLOCKED. It could not read {len(errors)} file(s), so the "
            "scan is incomplete."
        )
    serious = [
        each
        for each in results
        if not isinstance(each, dict) or each.get("issue_severity") in BLOCKING
    ]
    if serious:
        lines = [f"Bandit: BLOCKED. {len(serious)} high-severity finding(s):"]
        lines.extend(_line(each) for each in serious)
        return 1, "\n".join(lines)
    return 0, f"Bandit: no high-severity findings ({len(results)} lower ones)."


def _line(finding: Any) -> str:
    """Describe one finding in a line for the log."""
    if not isinstance(finding, dict):
        return "  - a finding this script cannot read"
    return (
        f"  - {finding.get('test_id', '?')} "
        f"{finding.get('filename', '?')}:{finding.get('line_number', '?')}"
    )


def run(path: Path) -> tuple[int, str]:
    """Judge the report saved at a path.

    Args:
        path: Where Bandit wrote its JSON report.

    Returns:
        The exit code and what to print. A report that is missing or is
        not JSON blocks.
    """
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 1, "Bandit: BLOCKED. There is no report that can be read."
    return judge(report)


def main(argv: Sequence[str] | None = None) -> int:
    """Run from the command line.

    Args:
        argv: The arguments; the process's own by default.

    Returns:
        0 to go on, 1 when blocked.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument("report", type=Path)
    arguments = parser.parse_args(argv)
    code, message = run(arguments.report)
    sys.stdout.write(message + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
