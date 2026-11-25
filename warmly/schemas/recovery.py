"""Recovery envelope models (PRD SEC-003)."""

from typing import Self

from pydantic import Field, model_validator

from warmly.schemas.common import ApiModel, SmallCiphertext

# The newest recovery-envelope format this server knows. A client cannot store
# an envelope in a format the server has never heard of.
LATEST_RECOVERY_FORMAT = 1


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
    format_version: int = Field(ge=1, le=LATEST_RECOVERY_FORMAT)
    wrapped_key: SmallCiphertext
    device_enrollment_verifier: SmallCiphertext | None = Field(
        default=None,
        description=(
            "Required when creating the envelope (expected_version 0) and "
            "refused otherwise. A value derived one-way from the root key, "
            "which a new device must prove it knows before it can register."
        ),
    )

    @model_validator(mode="after")
    def _verifier_only_on_create(self) -> Self:
        """Require the verifier exactly when the envelope is being created."""
        creating = self.expected_version == 0
        if creating != (self.device_enrollment_verifier is not None):
            msg = (
                "device_enrollment_verifier is required when expected_version "
                "is 0 and must be absent otherwise"
            )
            raise ValueError(msg)
        return self
