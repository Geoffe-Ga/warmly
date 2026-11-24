"""Device registry routes (PRD DEV-002, DEV-003). Stubs: nothing is stored."""

from uuid import UUID

from fastapi import APIRouter, Depends, status

from warmly.api.fixtures import STUB_CIPHERTEXT, STUB_PUBLIC_KEY, STUB_TIME
from warmly.api.stub import mark_stub
from warmly.schemas.devices import (
    Device,
    DeviceList,
    RegisterDeviceRequest,
    RenameDeviceRequest,
)
from warmly.schemas.problem import Problem

router = APIRouter(
    prefix="/devices",
    tags=["devices"],
    dependencies=[Depends(mark_stub)],
    responses={422: {"model": Problem}},
)


@router.get("", summary="List the caller's devices")
def list_devices() -> DeviceList:
    """List the signed-in user's devices.

    Stub: always an empty list.

    Returns:
        An empty device list.
    """
    return DeviceList(devices=[])


@router.post(
    "", status_code=status.HTTP_201_CREATED, summary="Register the calling device"
)
def register_device(request: RegisterDeviceRequest) -> Device:
    """Register the calling device's identity.

    Stub: echoes the submitted identity without storing it.

    Args:
        request: The device's ID, public key and encrypted name.

    Returns:
        The device as it would have been registered.
    """
    return Device(
        id=request.device_id,
        name_ciphertext=request.name_ciphertext,
        public_key=request.public_key,
        created_at=STUB_TIME,
        is_current=True,
    )


@router.patch("/{device_id}", summary="Rename a device")
def rename_device(device_id: UUID, request: RenameDeviceRequest) -> Device:
    """Replace a device's encrypted display name.

    Stub: echoes the new name without storing it.

    Args:
        device_id: The device to rename.
        request: The new encrypted name.

    Returns:
        The device as it would look after the rename.
    """
    return Device(
        id=device_id,
        name_ciphertext=request.name_ciphertext,
        public_key=STUB_PUBLIC_KEY,
        created_at=STUB_TIME,
        is_current=False,
    )


@router.post("/{device_id}/revoke", summary="Revoke a device")
def revoke_device(device_id: UUID) -> Device:
    """Revoke a device so it can no longer sync.

    Stub: returns a revoked device without changing anything.

    Args:
        device_id: The device to revoke.

    Returns:
        The device with ``revoked_at`` set.
    """
    return Device(
        id=device_id,
        name_ciphertext=STUB_CIPHERTEXT,
        public_key=STUB_PUBLIC_KEY,
        created_at=STUB_TIME,
        revoked_at=STUB_TIME,
        is_current=False,
    )
