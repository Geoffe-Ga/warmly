"""Uniform RFC 9457 error responses.

Every error body is a ``Problem``. Validation errors list which fields were
wrong but never repeat the submitted values, because request bodies carry
ciphertext and, later, credentials.
"""

from http import HTTPStatus

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from warmly.schemas.problem import FieldError, Problem

PROBLEM_MEDIA_TYPE = "application/problem+json"

_CODES_BY_STATUS = {
    HTTPStatus.NOT_FOUND: "request.not_found",
    HTTPStatus.METHOD_NOT_ALLOWED: "request.method_not_allowed",
}


def problem_response(problem: Problem) -> JSONResponse:
    """Serialise a problem with the problem-details media type.

    Args:
        problem: The body to send; its ``status`` becomes the HTTP status.

    Returns:
        The JSON response.
    """
    return JSONResponse(
        status_code=problem.status,
        content=problem.model_dump(mode="json"),
        media_type=PROBLEM_MEDIA_TYPE,
    )


def validation_problem(exc: RequestValidationError) -> Problem:
    """Describe a request-validation failure without echoing any input.

    Args:
        exc: The validation error raised by FastAPI.

    Returns:
        A 422 problem naming each invalid field and what is wrong with it.
    """
    errors = [
        FieldError(
            location=".".join(str(part) for part in error["loc"]),
            message=str(error["msg"]),
        )
        for error in exc.errors()
    ]
    return Problem(
        title="Invalid request",
        status=HTTPStatus.UNPROCESSABLE_ENTITY,
        code="request.invalid",
        errors=errors,
    )


def http_problem(status_code: int) -> Problem:
    """Describe a framework HTTP error such as 404 or 405.

    Args:
        status_code: The HTTP status raised by Starlette or a route.

    Returns:
        A problem with a stable code for that status.
    """
    status = HTTPStatus(status_code)
    code = _CODES_BY_STATUS.get(status, f"http.{status.value}")
    return Problem(title=status.phrase, status=status, code=code)


async def handle_error(_request: object, exc: Exception) -> JSONResponse:
    """Turn a handled exception into a problem response.

    Registered for request-validation errors and HTTP exceptions. Anything
    else is re-raised so it surfaces as a real server error.

    Args:
        _request: The failing request (unused).
        exc: The exception being handled.

    Returns:
        The problem response.
    """
    if isinstance(exc, RequestValidationError):
        return problem_response(validation_problem(exc))
    if isinstance(exc, HTTPException):
        return problem_response(http_problem(exc.status_code))
    raise exc


def install_error_handlers(app: FastAPI) -> None:
    """Register the problem-details handlers on the application.

    Args:
        app: The FastAPI application to configure.
    """
    app.add_exception_handler(RequestValidationError, handle_error)
    app.add_exception_handler(HTTPException, handle_error)
