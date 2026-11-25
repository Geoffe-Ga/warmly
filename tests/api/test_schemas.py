"""Model-level invariants of the wire contract."""

from uuid import UUID

import pytest
from pydantic import ValidationError

from tests.sync_scenarios import SCENARIOS, VERSION, expected, wire
from warmly.schemas.sync import OperationResult, SyncOperation

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


OPERATION = {
    "op_id": OP_ID,
    "record_id": UUID("22222222-2222-4222-8222-222222222222"),
    "type": 1,
    "base_revision": 0,
    "schema_version": 1,
}


def test_a_write_needs_a_payload_and_a_tombstone_must_not_have_one() -> None:
    """The payload is present exactly when the operation is not a delete."""
    SyncOperation.model_validate(OPERATION | {"tombstone": False, "payload": "b3A="})
    SyncOperation.model_validate(OPERATION | {"tombstone": True})

    with pytest.raises(ValidationError, match="needs a payload"):
        SyncOperation.model_validate(OPERATION | {"tombstone": False})
    with pytest.raises(ValidationError, match="carries no payload"):
        SyncOperation.model_validate(OPERATION | {"tombstone": True, "payload": "b3A="})


_STEPS = [
    (name, index, step) for name, steps in SCENARIOS for index, step in enumerate(steps)
]


@pytest.mark.parametrize(
    ("name", "index", "step"),
    _STEPS,
    ids=[f"{name} #{index}" for name, index, _ in _STEPS],
)
def test_the_wire_models_carry_every_step_of_the_adr_0006_scenario_table(
    name: str, index: int, step: dict[str, dict[str, object]]
) -> None:
    """Every operation and result in the shared table is a valid wire model."""
    operation = SyncOperation.model_validate(wire(step["operation"]))
    result = OperationResult.model_validate(
        {"op_id": step["operation"]["op_id"]} | step["expect"]
    )

    assert operation.tombstone is (operation.payload is None), (name, index)
    assert result.model_dump(mode="json") == expected(step)


def test_the_scenario_table_uses_only_the_statuses_the_api_defines() -> None:
    """The shared table and the API agree on the set of result statuses."""
    used = {step["expect"]["status"] for _, _, step in _STEPS}

    assert used == {"applied", "duplicate", "conflict", "deleted", "rejected"}
    assert VERSION == 1
