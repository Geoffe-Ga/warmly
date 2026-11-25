"""Device registry routes (PRD DEV-002, DEV-003, DEV-010; ADR-0005).

A device registers its public key once, then signs every request. Listing and
renaming only ever touch the caller's own devices: a device ID that belongs to
another account is answered exactly like one that does not exist.
"""

from http import HTTPStatus
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status

from warmly.api.errors import SIGNED_IN_RESPONSES, ProblemError
from warmly.api.ports import DeviceStore, RecoveryStore
from warmly.auth.dependency import CurrentOwner
from warmly.auth.device import (
    NOT_AUTHORIZED,
    CurrentCaller,
    DeviceAuthorizationError,
    DeviceVerifier,
    enrollment_proof_is_valid,
    read_signed_request,
    signature_is_valid,
)
from warmly.auth.verifier import LEEWAY_SECONDS
from warmly.schemas.devices import (
    Device,
    DeviceList,
    RegisterDeviceRequest,
    RenameDeviceRequest,
)
from warmly.schemas.problem import Problem

NOT_FOUND_CODE = "device.not_found"
ALREADY_REGISTERED_CODE = "device.already_registered"
ACCOUNT_NOT_READY_CODE = "device.account_not_ready"
REAUTHENTICATION_REQUIRED_CODE = "auth.reauthentication_required"
# How recently the password must have been entered to revoke a device.
REAUTHENTICATION_SECONDS = 300

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": Problem, "description": "No such device on this account"}
}
_REAUTHENTICATE: dict[int | str, dict[str, Any]] = {
    403: {
        "model": Problem,
        "description": "The password must be entered again before doing this",
    }
}
_CONFLICT: dict[int | str, dict[str, Any]] = {
    409: {
        "model": Problem,
        "description": (
            "The device ID is already registered, or the account has not "
            "created its keys yet"
        ),
    }
}

router = APIRouter(prefix="/devices", tags=["devices"], responses=SIGNED_IN_RESPONSES)


def _devices(request: Request) -> DeviceStore:
    """Return the application's device store."""
    store: DeviceStore = request.app.state.device_store
    return store


def _recovery(request: Request) -> RecoveryStore:
    """Return the application's recovery store."""
    store: RecoveryStore = request.app.state.recovery_store
    return store


Devices = Annotated[DeviceStore, Depends(_devices)]
Recovery = Annotated[RecoveryStore, Depends(_recovery)]


@router.get("", summary="List the caller's devices")
async def list_devices(caller: CurrentCaller, devices: Devices) -> DeviceList:
    """List the signed-in user's own devices.

    Args:
        caller: The verified account and device.
        devices: Where devices are kept.

    Returns:
        The account's devices, oldest first, with the calling one marked.
    """
    return DeviceList(devices=await devices.list(caller.owner.id, caller.device_id))


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Register the calling device",
    responses=_CONFLICT,
)
async def register_device(
    request: RegisterDeviceRequest,
    http_request: Request,
    owner: CurrentOwner,
    devices: Devices,
    recovery: Recovery,
) -> Device:
    """Register the calling device's identity.

    A device cannot sign with a registered key before it has one, so this
    route checks two other things instead:

    - the request is signed with the very key being registered, which proves
      the caller holds the private key;
    - the enrollment proof, which proves the caller knows the account root
      key. A stolen session token cannot produce it.

    Args:
        request: The device's ID, public key, encrypted name and proof.
        http_request: The request, for its signature.
        owner: The verified account.
        devices: Where devices are kept.
        recovery: Where the account's enrollment verifier is kept.

    Returns:
        The registered device.

    Raises:
        DeviceAuthorizationError: If the signature or the proof is not valid.
        ProblemError: 409 if the account has no keys yet, or the device ID is
            already registered.
    """
    signed = await read_signed_request(http_request)
    verifier: DeviceVerifier = http_request.app.state.device_verifier
    # No nonce is recorded here: the device has no row to record it against
    # yet, and a replayed registration is refused anyway, because the device
    # ID is then already registered.
    verifier.check_timestamp(signed.timestamp)
    if signed.device_id != str(request.device_id) or not signature_is_valid(
        request.public_key, signed.message(), signed.signature
    ):
        raise DeviceAuthorizationError(NOT_AUTHORIZED)
    expected = await recovery.enrollment_verifier(owner.id)
    if expected is None:
        raise ProblemError(HTTPStatus.CONFLICT, ACCOUNT_NOT_READY_CODE)
    if not enrollment_proof_is_valid(
        expected, request.device_id, request.public_key, request.enrollment_proof
    ):
        raise DeviceAuthorizationError(NOT_AUTHORIZED)
    device = await devices.register(owner.id, request)
    if device is None:
        raise ProblemError(HTTPStatus.CONFLICT, ALREADY_REGISTERED_CODE)
    return device


@router.patch("/{device_id}", summary="Rename a device", responses=_NOT_FOUND)
async def rename_device(
    device_id: UUID,
    request: RenameDeviceRequest,
    caller: CurrentCaller,
    devices: Devices,
) -> Device:
    """Replace a device's encrypted display name.

    Args:
        device_id: The device to rename.
        request: The new encrypted name.
        caller: The verified account and device.
        devices: Where devices are kept.

    Returns:
        The device after the rename.

    Raises:
        ProblemError: 404 if the device is not one of the caller's, whether
            or not it exists on another account.
    """
    device = await devices.rename(
        caller.owner.id, device_id, request.name_ciphertext, caller.device_id
    )
    if device is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    return device


@router.post(
    "/{device_id}/revoke",
    summary="Revoke a device",
    responses=_NOT_FOUND | _REAUTHENTICATE,
)
async def revoke_device(
    device_id: UUID, http_request: Request, caller: CurrentCaller, devices: Devices
) -> Device:
    """Revoke a device so that nothing it sends is accepted again.

    The request must be signed by one of the account's devices, and the
    session must show that the password was entered in the last few minutes:
    someone who picks up an unlocked device cannot revoke the owner's others.
    A device may revoke itself. A revoked device ID can never be used again.

    Args:
        device_id: The device to revoke.
        http_request: The request, for the application's clock.
        caller: The verified account and device.
        devices: Where devices are kept.

    Returns:
        The device with ``revoked_at`` set.

    Raises:
        ProblemError: 403 if the password was not entered recently; 404 if
            the device is not one of the caller's, whether or not it exists
            on another account.
    """
    now: float = http_request.app.state.clock()
    entered_at = caller.owner.password_entered_at
    if (
        entered_at is None
        or not -LEEWAY_SECONDS <= now - entered_at <= REAUTHENTICATION_SECONDS
    ):
        raise ProblemError(HTTPStatus.FORBIDDEN, REAUTHENTICATION_REQUIRED_CODE)
    device = await devices.revoke(caller.owner.id, device_id, caller.device_id)
    if device is None:
        raise ProblemError(HTTPStatus.NOT_FOUND, NOT_FOUND_CODE)
    return device
