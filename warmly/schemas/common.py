"""Shared building blocks for the API models."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

# Standard base64 alphabet with optional padding. The pattern checks shape
# only; the value is never decoded on the server.
_BASE64_PATTERN = r"^[A-Za-z0-9+/]+={0,2}$"

# Upper bound for one encrypted record, in base64 characters (about 1 MiB of
# ciphertext). Large enough for any journal entry or Reflect session.
MAX_PAYLOAD_CHARS = 1_400_000

# Upper bound for small encrypted values such as a device name or wrapped key.
MAX_SMALL_CIPHERTEXT_CHARS = 4_096

# An opaque client-encrypted record payload, base64 encoded.
Ciphertext = Annotated[
    str,
    StringConstraints(
        min_length=1, max_length=MAX_PAYLOAD_CHARS, pattern=_BASE64_PATTERN
    ),
]

# A short opaque encrypted value, base64 encoded.
SmallCiphertext = Annotated[
    str,
    StringConstraints(
        min_length=1, max_length=MAX_SMALL_CIPHERTEXT_CHARS, pattern=_BASE64_PATTERN
    ),
]

# A device public key, base64 encoded.
PublicKey = Annotated[
    str,
    StringConstraints(
        min_length=1, max_length=MAX_SMALL_CIPHERTEXT_CHARS, pattern=_BASE64_PATTERN
    ),
]


class ApiModel(BaseModel):
    """Base for every API model: immutable and closed to unknown fields.

    Rejecting unknown fields means a client cannot smuggle in values such as an
    owner identifier; ownership always comes from the authenticated session.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
