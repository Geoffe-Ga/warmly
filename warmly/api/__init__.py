"""HTTP routers for the Warmly API, mounted under ``/v1``."""

from fastapi import APIRouter

from warmly.api import devices, enrollment, health, recovery, sync

API_PREFIX = "/v1"


def build_api_router() -> APIRouter:
    """Assemble every ``/v1`` router.

    Returns:
        A router containing the complete versioned API surface.
    """
    router = APIRouter(prefix=API_PREFIX)
    router.include_router(health.router)
    router.include_router(sync.router)
    router.include_router(devices.router)
    router.include_router(enrollment.router)
    router.include_router(recovery.router)
    return router
