"""Liveness and readiness routes."""

from fastapi import APIRouter

from warmly import __version__
from warmly.schemas.health import Health, Readiness

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness check")
def get_health() -> Health:
    """Report that the process is running.

    Returns:
        The API version and an ``ok`` status.
    """
    return Health(version=__version__)


@router.get("/ready", summary="Readiness check")
def get_ready() -> Readiness:
    """Report that the API can serve requests.

    There are no dependencies to check yet; the database check arrives with
    the persistence layer.

    Returns:
        A ``ready`` status with an empty set of dependency checks.
    """
    return Readiness()
