"""The published matrix is the one the suite runs (SEC-006)."""

from tests.security.matrix import ATTACKS, CASES, OPERATIONS
from tests.security.render import DOCUMENT, render


def test_the_published_matrix_matches_the_suite() -> None:
    """Regenerate with ``python -m tests.security.render`` when this fails."""
    assert DOCUMENT.read_text(encoding="utf-8") == render()


def test_the_document_marks_exactly_the_cells_that_are_tested() -> None:
    """One "tested" per case the suite runs, so the table cannot overstate."""
    rows = [line for line in render().splitlines() if line.startswith("| `")]

    assert len(rows) == len(OPERATIONS)
    assert sum(row.count("| tested") for row in rows) == len(CASES)
    assert sum(row.count("| n/a") for row in rows) == (
        len(OPERATIONS) * len(ATTACKS) - len(CASES)
    )


def test_the_document_says_what_is_not_proven() -> None:
    """PRD §13.9: a security claim comes with its limits."""
    text = render()

    assert "## What this does not prove" in text
    for limit in ("Timing", "The client", "The auth provider"):
        assert f"**{limit}.**" in text
