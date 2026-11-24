"""HTTP routers for the Warmly API, mounted under ``/v1``."""

from collections.abc import Mapping

from fastapi import APIRouter

from warmly.api import devices, enrollment, recovery, sync
from warmly.api.health import ReadinessCheck, build_health_router

API_PREFIX = "/v1"


def build_api_router(readiness_checks: Mapping[str, ReadinessCheck]) -> APIRouter:
    """Assemble every ``/v1`` router.

    Args:
        readiness_checks: Named dependency checks for the readiness route.

    Returns:
        A router containing the complete versioned API surface.
    """
    router = APIRouter(prefix=API_PREFIX)
    router.include_router(build_health_router(readiness_checks))
    router.include_router(sync.router)
    router.include_router(devices.router)
    router.include_router(enrollment.router)
    router.include_router(recovery.router)
    return router
