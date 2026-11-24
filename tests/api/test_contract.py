"""The committed OpenAPI contract matches the code."""

import json
from pathlib import Path

from warmly.contract import CONTRACT_PATH, render_contract, write_contract

REGENERATE = "python -m warmly.contract && ./scripts/typescript/contract.sh"


def test_committed_contract_is_up_to_date() -> None:
    """Fails when a route or model changed without regenerating the contract."""
    assert CONTRACT_PATH.read_text(encoding="utf-8") == render_contract(), (
        f"openapi/warmly.v1.json is stale. Regenerate with: {REGENERATE}"
    )


def test_contract_is_deterministic() -> None:
    """Two renders are byte-identical, so the drift check cannot flap."""
    assert render_contract() == render_contract()


def test_contract_documents_only_versioned_paths() -> None:
    """Every path lives under /v1."""
    paths = json.loads(render_contract())["paths"]

    assert paths
    assert all(path.startswith("/v1/") for path in paths)


def test_write_contract_creates_the_file(tmp_path: Path) -> None:
    """The writer creates parent directories and writes the rendered text."""
    target = tmp_path / "nested" / "contract.json"

    write_contract(target)

    assert target.read_text(encoding="utf-8") == render_contract()
