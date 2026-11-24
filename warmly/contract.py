"""Render the OpenAPI contract deterministically.

The rendered text is committed to ``openapi/warmly.v1.json``. A test compares
the two, so the committed contract can never drift from the code.
"""

import json
from pathlib import Path

from warmly.app import create_app

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "openapi" / "warmly.v1.json"


def render_contract() -> str:
    """Serialise the application's OpenAPI schema with stable formatting.

    Returns:
        The schema as indented JSON with sorted keys and a trailing newline.
    """
    schema = create_app().openapi()
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def write_contract(path: Path = CONTRACT_PATH) -> None:
    """Write the rendered contract to disk.

    Args:
        path: Destination file; defaults to the committed contract.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_contract(), encoding="utf-8")


if __name__ == "__main__":
    write_contract()
