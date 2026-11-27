"""Which tests stand behind each acceptance criterion (PRD §11).

The PRD lists 28 acceptance criteria, `AC-01` to `AC-28`, and says each
must be represented in automated tests. A test in this repository says
which criteria it serves by ID. This script reads the PRD for the
criteria and the test files for those IDs, and writes the table that
joins them: `docs/traceability.md`.

An ID counts only where it is tied to a test. In Python that is the
docstring of a test function or of a `Test` class. In TypeScript it is
the title of an `it`, `test` or `describe`, or the comment directly above
one. An ID in a file's header, in a helper or in a test's body names no
test and is not counted, so a file cannot claim a criterion that none of
its tests is about.

It proves less than it might seem to. It shows that a test cites a
criterion. It does not show that the test is a good test of it, and it
does not read test results: whether the cited tests pass is what CI and
the Release Gate say. A criterion with no file is a fact worth knowing
either way, and `--require-all` fails on one.

Usage:
    python -m scripts.release.traceability            # print the table
    python -m scripts.release.traceability --write    # update the document
    python -m scripts.release.traceability --check    # fail if it is stale
    python -m scripts.release.traceability --require-all  # fail on a gap
"""

import argparse
import ast
import re
import sys
from collections.abc import Collection, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

# Where the criteria are defined, and where the table is written.
PRD_PATH = "docs/plans/relationship_communication_agent_prd.md"
DOCUMENT_PATH = "docs/traceability.md"
# The kinds of test, by where their files live. Order is the table's order.
LAYERS = (
    ("Backend (pytest)", "tests", (".py",)),
    ("Frontend (Vitest)", "tests/frontend", (".ts", ".tsx")),
    ("Browser (Playwright)", "e2e", (".ts",)),
)
# Folders that hold no tests of their own.
SKIPPED_PARTS = frozenset({"__pycache__", "node_modules", "fixtures"})

_CRITERION = re.compile(r"^\d+\. \*\*\[(AC-\d{2})\]\*\* (.+)$")
_CITED = re.compile(r"\bAC-\d{2}\b")
# A test or a group of tests in TypeScript, at the start of a line:
# `it(`, `test.skip(`, `describe.each(`, `test.describe.serial(`. What may
# follow the dot is listed, so that `test.beforeEach(`, `test.step(` and
# `test.use(`, which are not tests, are not taken for one.
_TEST_FORMS = (
    "concurrent|describe|each|fails|fixme|only|parallel|runIf|sequential"
    "|serial|skip|skipIf|todo"
)
_TEST_CALL = re.compile(
    rf"^[ \t]*(?:describe|it|test)(?:\.(?:{_TEST_FORMS}))*\(", re.MULTILINE
)
_QUOTES = "\"'`"


@dataclass(frozen=True)
class Criterion:
    """One acceptance criterion.

    Attributes:
        id: Its ID, such as `AC-07`.
        text: What the PRD says must be true.
    """

    id: str
    text: str


def criteria(prd: str) -> list[Criterion]:
    """Read the acceptance criteria out of the PRD.

    Args:
        prd: The PRD's text.

    Returns:
        The criteria, in the PRD's order.
    """
    found = []
    for line in prd.splitlines():
        match = _CRITERION.match(line.strip())
        if match:
            found.append(Criterion(id=match.group(1), text=match.group(2)))
    return found


def _python_cited(text: str) -> set[str]:
    """Find the criteria named in the docstrings of tests and test classes."""
    try:
        tree = ast.parse(text)
    except SyntaxError:
        # The test runner reports a file it cannot read; this table does not.
        return set()
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            prefix = "test_"
        elif isinstance(node, ast.ClassDef):
            prefix = "Test"
        else:
            continue
        if node.name.startswith(prefix):
            found.update(_CITED.findall(ast.get_docstring(node) or ""))
    return found


def _string_end(text: str, start: int) -> int:
    """Find where the string literal that opens at `start` closes.

    Returns:
        The index of the closing quote, or the end of the text if the
        string is never closed.
    """
    quote = text[start]
    index = start + 1
    while index < len(text) and text[index] != quote:
        index += 2 if text[index] == "\\" else 1
    return min(index, len(text))


def _group_end(text: str, start: int) -> int:
    """Find the index after the bracket that closes the one before `start`.

    Brackets inside string literals are not counted.
    """
    depth = 1
    index = start
    while index < len(text) and depth > 0:
        char = text[index]
        if char in _QUOTES:
            index = _string_end(text, index)
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        index += 1
    return index


def _string_from(text: str, start: int) -> str | None:
    """Read the string literal that begins at or after `start`, past spaces."""
    index = start
    while index < len(text) and text[index].isspace():
        index += 1
    if index < len(text) and text[index] in _QUOTES:
        return text[index + 1 : _string_end(text, index)]
    return None


def _title(text: str, start: int) -> str:
    """Read the title of the test whose opening bracket is before `start`.

    A table test is written `it.each(table)("title", ...)`: its title is
    the first thing in the second pair of brackets.
    """
    title = _string_from(text, start)
    if title is None:
        after = _group_end(text, start)
        if text[after : after + 1] == "(":
            title = _string_from(text, after + 1)
    return title or ""


def _comment_above(text: str, start: int) -> str:
    """Read the comment that ends on the line directly above `start`."""
    lines = text[:start].splitlines()
    comment: list[str] = []
    for line in reversed(lines):
        if not line.strip().startswith(("//", "/*", "*")):
            break
        comment.append(line)
    return "\n".join(comment)


def _typescript_cited(text: str) -> set[str]:
    """Find the criteria named in test titles and the comments above them."""
    found: set[str] = set()
    for call in _TEST_CALL.finditer(text):
        found.update(_CITED.findall(_title(text, call.end())))
        found.update(_CITED.findall(_comment_above(text, call.start())))
    return found


def cited_in(text: str, suffix: str) -> set[str]:
    """Find the criteria a test file's tests say they serve.

    Args:
        text: The file's text.
        suffix: The file's ending, which says what language it is in.

    Returns:
        The IDs tied to a test: see this module's docstring for where an
        ID has to be.
    """
    return _python_cited(text) if suffix == ".py" else _typescript_cited(text)


def _is_test_file(path: Path, suffixes: tuple[str, ...]) -> bool:
    """Say whether a file is one a test runner collects."""
    name = path.name
    if path.suffix not in suffixes:
        return False
    if path.suffix == ".py":
        return name.startswith("test_")
    return name.endswith((".test.ts", ".test.tsx", ".spec.ts"))


def test_files(root: Path, folder: str, suffixes: tuple[str, ...]) -> Iterator[Path]:
    """List the test files of one layer.

    Args:
        root: The top of the repository.
        folder: The layer's folder, relative to the top.
        suffixes: The file endings its tests have.

    Yields:
        Each test file, in a fixed order.
    """
    for path in sorted((root / folder).rglob("*")):
        relative = path.relative_to(root)
        if SKIPPED_PARTS.isdisjoint(relative.parts) and _is_test_file(path, suffixes):
            yield path


def _layer_of(relative: str) -> str:
    """Name the layer a test file belongs to: the most specific folder wins."""
    best = max(
        (layer for layer in LAYERS if relative.startswith(layer[1] + "/")),
        key=lambda layer: len(layer[1]),
    )
    return best[0]


def citations(root: Path) -> dict[str, dict[str, list[str]]]:
    """Find which test files cite which criteria.

    Args:
        root: The top of the repository.

    Returns:
        For each criterion ID, the files that cite it, by layer. A file is
        listed once per criterion however often it cites it.
    """
    found: dict[str, dict[str, list[str]]] = {}
    # No file is met twice: the layers that share a folder differ in the
    # file endings they collect.
    for _, folder, suffixes in LAYERS:
        for path in test_files(root, folder, suffixes):
            relative = path.relative_to(root).as_posix()
            cited = sorted(cited_in(path.read_text(encoding="utf-8"), path.suffix))
            for criterion in cited:
                by_layer = found.setdefault(criterion, {})
                by_layer.setdefault(_layer_of(relative), []).append(relative)
    return found


def loose(root: Path) -> dict[str, list[str]]:
    """Find test files that name a criterion none of their tests is tied to.

    Such a mention claims nothing in the table, and reads as if it did.

    Args:
        root: The top of the repository.

    Returns:
        For each such file, the IDs it names somewhere but ties to no test.
    """
    found: dict[str, list[str]] = {}
    for _, folder, suffixes in LAYERS:
        for path in test_files(root, folder, suffixes):
            text = path.read_text(encoding="utf-8")
            untied = set(_CITED.findall(text)) - cited_in(text, path.suffix)
            if untied:
                found[path.relative_to(root).as_posix()] = sorted(untied)
    return found


def uncovered(listed: Sequence[Criterion], cited: Collection[str]) -> list[str]:
    """Name the criteria no test file cites.

    Args:
        listed: The criteria the PRD lists.
        cited: The criteria test files cite.

    Returns:
        Their IDs, in the PRD's order.
    """
    return [each.id for each in listed if each.id not in cited]


def render(listed: Sequence[Criterion], cited: dict[str, dict[str, list[str]]]) -> str:
    """Write the table as Markdown.

    Args:
        listed: The criteria the PRD lists.
        cited: The files that cite each, by layer.

    Returns:
        The whole document.
    """
    gaps = uncovered(listed, cited)
    lines = [
        "# Traceability: acceptance criteria to tests",
        "",
        "<!-- Generated by `python -m scripts.release.traceability --write`.",
        "     Do not edit by hand: a test fails when this file is out of date. -->",
        "",
        "Each acceptance criterion in the PRD (§11), and the test files in",
        "which a test cites it by ID: in its docstring (Python), or in its",
        "title or the comment directly above it (TypeScript).",
        "",
        "**What this shows:** that a test names the criterion. **What it",
        "does not show:** that the test is a sufficient test of it, or that it",
        "passes. Whether tests pass is what CI and the Release Gate report",
        "(`docs/runbooks/release-gates.md`).",
        "",
        f"- Criteria in the PRD: {len(listed)}",
        f"- Cited by at least one test file: {len(listed) - len(gaps)}",
        f"- Cited by none: {len(gaps)}" + (f" ({', '.join(gaps)})" if gaps else ""),
        "",
    ]
    for criterion in listed:
        lines.extend([f"## {criterion.id}", "", criterion.text, ""])
        by_layer = cited.get(criterion.id, {})
        if not by_layer:
            lines.extend(["**No test file cites this criterion.**", ""])
            continue
        for layer, _, _ in LAYERS:
            files = by_layer.get(layer, [])
            if files:
                lines.append(f"- {layer}:")
                lines.extend(f"  - `{each}`" for each in files)
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def build(root: Path) -> tuple[str, list[str]]:
    """Make the document for a repository.

    Args:
        root: The top of the repository.

    Returns:
        The document's text, and the IDs of criteria no test cites.
    """
    listed = criteria((root / PRD_PATH).read_text(encoding="utf-8"))
    cited = citations(root)
    return render(listed, cited), uncovered(listed, cited)


def run(root: Path, mode: str) -> tuple[int, str]:
    """Do one of the script's jobs.

    Args:
        root: The top of the repository.
        mode: `print`, `write`, `check` or `require-all`.

    Returns:
        The exit code and what to print.
    """
    document, gaps = build(root)
    target = root / DOCUMENT_PATH
    if mode == "write":
        target.write_text(document, encoding="utf-8")
        return 0, f"Wrote {DOCUMENT_PATH}."
    if mode == "check":
        current = target.read_text(encoding="utf-8") if target.is_file() else ""
        if current == document:
            return 0, f"{DOCUMENT_PATH} is up to date."
        return 1, (
            f"{DOCUMENT_PATH} is out of date. Run: "
            "python -m scripts.release.traceability --write"
        )
    if mode == "require-all":
        if gaps:
            return 1, "No test file cites: " + ", ".join(gaps)
        return 0, "Every acceptance criterion is cited by at least one test file."
    return 0, document.rstrip("\n")


def main(argv: Sequence[str] | None = None) -> int:
    """Run from the command line.

    Args:
        argv: The arguments; the process's own by default.

    Returns:
        0, or 1 when a check fails.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    group = parser.add_mutually_exclusive_group()
    for mode in ("write", "check", "require-all"):
        group.add_argument(f"--{mode}", dest="mode", action="store_const", const=mode)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    arguments = parser.parse_args(argv)
    code, message = run(arguments.root, arguments.mode or "print")
    sys.stdout.write(message + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
