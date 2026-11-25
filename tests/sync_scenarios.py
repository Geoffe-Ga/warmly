"""The ADR-0006 scenario table, for tests of anything that applies operations.

``tests/fixtures/sync/scenarios-v1.json`` is the table in runnable form. The
client's in-memory server, the wire models, the route and the PostgreSQL
store are all tested against it, so they cannot drift apart.
"""

import base64
import json
from pathlib import Path
from typing import Any

_TABLE = json.loads(
    (Path(__file__).parent / "fixtures" / "sync" / "scenarios-v1.json").read_text(
        encoding="utf-8"
    )
)

VERSION: int = _TABLE["version"]

# Each scenario's name and its steps: an operation and the result it gets.
SCENARIOS: list[tuple[str, list[dict[str, Any]]]] = [
    (scenario["name"], scenario["steps"]) for scenario in _TABLE["scenarios"]
]

SCENARIO_IDS = [name for name, _ in SCENARIOS]


def wire(operation: dict[str, Any]) -> dict[str, Any]:
    """Give a fixture operation a base64 payload, as the wire format needs.

    Args:
        operation: An operation from the table, whose payload is a
            placeholder string or ``None``.

    Returns:
        The same operation with its payload base64 encoded.
    """
    payload = operation["payload"]
    if payload is None:
        return operation
    return operation | {"payload": base64.b64encode(payload.encode()).decode()}


def expected(step: dict[str, Any]) -> dict[str, Any]:
    """Return a step's expected result as the API reports it.

    Args:
        step: One step of a scenario.

    Returns:
        The result with every field present, absent ones as ``None``.
    """
    return {
        "op_id": step["operation"]["op_id"],
        "status": step["expect"]["status"],
        "revision": step["expect"].get("revision"),
        "current_revision": step["expect"].get("current_revision"),
    }
