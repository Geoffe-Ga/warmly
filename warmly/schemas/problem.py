"""RFC 9457 problem-details error bodies."""

from pydantic import Field

from warmly.schemas.common import ApiModel


class FieldError(ApiModel):
    """One invalid request field.

    The offending value is deliberately absent: request bodies can carry
    ciphertext or credentials, so they are never echoed back or logged.
    """

    location: str = Field(description="Dotted path of the invalid field.")
    message: str = Field(description="What is wrong with it.")


class Problem(ApiModel):
    """Error body returned with media type ``application/problem+json``."""

    type: str = Field(
        default="about:blank", description="URI identifying the problem type."
    )
    title: str = Field(description="Short, stable summary of the problem.")
    status: int = Field(description="HTTP status code.")
    code: str = Field(
        description="Stable machine-readable code, for example auth.missing_token."
    )
    errors: list[FieldError] = Field(
        default_factory=list, description="Per-field detail for invalid requests."
    )
