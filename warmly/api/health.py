"""Liveness and readiness routes."""

from collections.abc import Awaitable, Callable, Mapping
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from warmly import __version__
from warmly.api.errors import problem_response
from warmly.schemas.health import Health, Readiness
from warmly.schemas.problem import Problem

# A dependency check: answers whether one thing the API needs is usable.
ReadinessCheck = Callable[[], Awaitable[bool]]

NOT_READY_RESPONSES: dict[int | str, dict[str, Any]] = {
    503: {"model": Problem, "description": "A dependency is unavailable"}
}


def not_ready_problem() -> Problem:
    """Describe an API that cannot serve requests yet.

    Deliberately silent about which dependency failed and why: connection
    errors can contain host names and credentials.

    Returns:
        A 503 problem with a stable code.
    """
    return Problem(
        title="Service not ready",
        status=HTTPStatus.SERVICE_UNAVAILABLE,
        code="service.not_ready",
    )


def build_health_router(checks: Mapping[str, ReadinessCheck]) -> APIRouter:
    """Create the liveness and readiness routes.

    Args:
        checks: Named dependency checks that readiness must pass.

    Returns:
        A router with ``/health`` and ``/ready``.
    """
    router = APIRouter(tags=["health"])

    @router.get("/health", summary="Liveness check")
    def get_health() -> Health:
        """Report that the process is running.

        Returns:
            The API version and an ``ok`` status.
        """
        return Health(version=__version__)

    @router.get(
        "/ready",
        summary="Readiness check",
        response_model=Readiness,
        responses=NOT_READY_RESPONSES,
    )
    async def get_ready() -> Readiness | JSONResponse:
        """Report whether every dependency is usable.

        Returns:
            A ``ready`` status naming each passing check, or a 503 problem as
            soon as one fails.
        """
        for check in checks.values():
            if not await check():
                return problem_response(not_ready_problem())
        return Readiness(checks=dict.fromkeys(checks, "ok"))

    return router
