"""Health and readiness models."""

from typing import Literal

from pydantic import Field

from warmly.schemas.common import ApiModel


class Health(ApiModel):
    """Liveness: the process is running and can answer requests."""

    status: Literal["ok"] = "ok"
    version: str = Field(description="Version of the running API.")


class Readiness(ApiModel):
    """Readiness: every dependency the API needs is reachable."""

    status: Literal["ready"] = "ready"
    checks: dict[str, Literal["ok"]] = Field(
        default_factory=dict, description="Result of each dependency check."
    )
