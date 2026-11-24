"""Recovery envelope routes (PRD SEC-003). Stubs: nothing is stored."""

from fastapi import APIRouter, Depends

from warmly.api.errors import SIGNED_IN_RESPONSES
from warmly.api.fixtures import STUB_CIPHERTEXT
from warmly.api.stub import mark_stub
from warmly.auth.dependency import require_owner
from warmly.schemas.recovery import PutRecoveryEnvelopeRequest, RecoveryEnvelope

router = APIRouter(
    prefix="/recovery-envelope",
    tags=["recovery"],
    dependencies=[Depends(require_owner), Depends(mark_stub)],
    responses=SIGNED_IN_RESPONSES,
)


@router.get("", summary="Read the recovery envelope")
def get_recovery_envelope() -> RecoveryEnvelope:
    """Read the caller's wrapped root key.

    Stub: returns a fixed synthetic envelope.

    Returns:
        A version 1 envelope holding an obviously synthetic value.
    """
    return RecoveryEnvelope(version=1, format_version=1, wrapped_key=STUB_CIPHERTEXT)


@router.put("", summary="Create or rotate the recovery envelope")
def put_recovery_envelope(request: PutRecoveryEnvelopeRequest) -> RecoveryEnvelope:
    """Create or rotate the wrapped root key with compare-and-swap.

    Stub: echoes the envelope with the next version number, storing nothing.

    Args:
        request: The new envelope and the version it replaces.

    Returns:
        The envelope as it would have been stored.
    """
    return RecoveryEnvelope(
        version=request.expected_version + 1,
        format_version=request.format_version,
        wrapped_key=request.wrapped_key,
    )
