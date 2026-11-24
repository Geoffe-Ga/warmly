"""Model-level invariants of the wire contract."""

from uuid import UUID

import pytest
from pydantic import ValidationError

from warmly.schemas.sync import OperationResult

OP_ID = UUID("33333333-3333-4333-8333-333333333333")


@pytest.mark.parametrize("status", ["applied", "duplicate"])
def test_result_that_took_effect_carries_only_a_revision(status: str) -> None:
    """An applied or repeated operation reports the revision it produced."""
    result = OperationResult.model_validate(
        {"op_id": OP_ID, "status": status, "revision": 3}
    )

    assert result.revision == 3
    with pytest.raises(ValidationError, match="current_revision is only set"):
        OperationResult.model_validate(
            {"op_id": OP_ID, "status": status, "current_revision": 3}
        )


@pytest.mark.parametrize("status", ["conflict", "deleted", "rejected"])
def test_result_that_did_not_take_effect_cannot_claim_a_revision(status: str) -> None:
    """A refused operation may say what it lost to, never that it was stored."""
    result = OperationResult.model_validate(
        {"op_id": OP_ID, "status": status, "current_revision": 4}
    )

    assert result.current_revision == 4
    with pytest.raises(ValidationError, match="revision is only set"):
        OperationResult.model_validate(
            {"op_id": OP_ID, "status": status, "revision": 5}
        )
