"""Recovery envelope models (PRD SEC-003)."""

from pydantic import Field

from warmly.schemas.common import ApiModel, SmallCiphertext


class RecoveryEnvelope(ApiModel):
    """The account root key, wrapped by the user's recovery key.

    The server stores this opaque value only. It never receives the recovery
    secret or the unwrapped root key.
    """

    version: int = Field(ge=1, description="Increases on every rotation.")
    format_version: int = Field(ge=1, description="Wrapping format version.")
    wrapped_key: SmallCiphertext


class PutRecoveryEnvelopeRequest(ApiModel):
    """Create or rotate the recovery envelope with compare-and-swap."""

    expected_version: int = Field(
        ge=0, description="Version being replaced; 0 when none exists yet."
    )
    format_version: int = Field(ge=1)
    wrapped_key: SmallCiphertext
