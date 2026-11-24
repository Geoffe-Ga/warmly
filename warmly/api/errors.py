"""Uniform RFC 9457 error responses.

Every error body is a ``Problem``. Validation errors list which fields were
wrong but never repeat the submitted values, because request bodies carry
ciphertext and, later, credentials.
"""

from http import HTTPStatus
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from warmly.schemas.problem import FieldError, Problem

PROBLEM_MEDIA_TYPE = "application/problem+json"

# Shared OpenAPI entry for request-validation failures. The description is
# explicit because the standard phrase for 422 differs between Python versions,
# which would make the committed contract depend on the interpreter.
INVALID_REQUEST_RESPONSES: dict[int | str, dict[str, Any]] = {
    422: {"model": Problem, "description": "Invalid request"}
}

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

    Only Pydantic's own message is used. A custom validator added later must
    never put the offending value in its message.

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
    try:
        status = HTTPStatus(status_code)
    except ValueError:
        # A non-standard code has no phrase; describe it generically rather
        # than fail inside the error handler.
        return Problem(title="Error", status=status_code, code=f"http.{status_code}")
    code = _CODES_BY_STATUS.get(status, f"http.{status.value}")
    return Problem(title=status.phrase, status=status, code=code)


def internal_problem() -> Problem:
    """Describe an unexpected server failure without any detail.

    The exception text is never included: it can contain request data, and a
    client has no use for it.

    Returns:
        A fixed 500 problem.
    """
    return Problem(
        title="Internal server error",
        status=HTTPStatus.INTERNAL_SERVER_ERROR,
        code="server.internal_error",
    )


async def handle_error(_request: object, exc: Exception) -> JSONResponse:
    """Turn any exception into a problem response.

    Registered for request-validation errors, HTTP exceptions and, as the
    catch-all, every other exception. An unexpected exception becomes a fixed
    500 problem; nothing about it is sent to the client.

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
    return problem_response(internal_problem())


def install_error_handlers(app: FastAPI) -> None:
    """Register the problem-details handlers on the application.

    Args:
        app: The FastAPI application to configure.
    """
    app.add_exception_handler(RequestValidationError, handle_error)
    app.add_exception_handler(HTTPException, handle_error)
    app.add_exception_handler(Exception, handle_error)
