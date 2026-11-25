"""HTTP routers for the Warmly API, mounted under ``/v1``."""

from collections.abc import Mapping

from fastapi import APIRouter, Depends

from warmly.api import devices, enrollment, recovery, sync
from warmly.api.health import ReadinessCheck, build_health_router
from warmly.api.rate_limit import limit_requests

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
    # Every route that needs a signed-in caller is rate limited. Health and
    # readiness are not: they carry no account to count against.
    limited = [Depends(limit_requests)]
    for signed_in in (sync.router, devices.router, enrollment.router, recovery.router):
        router.include_router(signed_in, dependencies=limited)
    return router
