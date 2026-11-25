/**
 * The server's register of an account's devices, as the app reaches it
 * (PRD DEV-002, DEV-003, DEV-010).
 *
 * Device names cross this boundary encrypted. The server stores ciphertext
 * and never learns a name.
 */
import { ApiClient, ApiError } from "../api/client";
import type { components } from "../api/schema";
import type { AuthSession } from "../auth/auth-client";
import type { DeviceIdentity } from "./identity";

type WireDevice = components["schemas"]["Device"];
type WireRegistration = components["schemas"]["RegisterDeviceRequest"];
type WireRename = components["schemas"]["RenameDeviceRequest"];

/** A device as the register holds it. The name is still encrypted. */
export interface RegisteredDevice {
  readonly id: string;
  /** The device's name, sealed with the account root key, base64. */
  readonly nameCiphertext: string;
  /** When the device was registered, as an ISO 8601 timestamp. */
  readonly createdAt: string;
  /** When the device last synced, or `undefined` if it never has. */
  readonly lastSyncAt: string | undefined;
  readonly revoked: boolean;
  /** Whether this is the device making the request. */
  readonly isCurrent: boolean;
}

/** What a device sends to register itself. */
export interface DeviceRegistration {
  /** The device's name, sealed with the account root key, base64. */
  readonly nameCiphertext: string;
  /** Proof that the device knows the account root key, base64. */
  readonly enrollmentProof: string;
}

/** The register of the signed-in account's devices. */
export interface DeviceRegistry {
  /**
   * Register this device.
   *
   * @returns `false` if the device ID was already registered, which a device
   *   repeating an interrupted registration treats as success.
   */
  register(
    session: AuthSession,
    identity: DeviceIdentity,
    registration: DeviceRegistration,
  ): Promise<boolean>;
  /** @returns The account's own devices, oldest first. */
  list(
    session: AuthSession,
    identity: DeviceIdentity,
  ): Promise<RegisteredDevice[]>;
  /**
   * Replace a device's encrypted name.
   *
   * @returns `false` if the device is not one of the account's.
   */
  rename(
    session: AuthSession,
    identity: DeviceIdentity,
    deviceId: string,
    nameCiphertext: string,
  ): Promise<boolean>;
  /**
   * Revoke a device for good. The session must show that the password was
   * entered in the last few minutes.
   *
   * @returns `false` if the device is not one of the account's.
   * @throws ApiError `reauthentication_required` if the password was not
   *   entered recently enough.
   */
  revoke(
    session: AuthSession,
    identity: DeviceIdentity,
    deviceId: string,
  ): Promise<boolean>;
}

const PATH = "/v1/devices";

function isWireDevice(value: unknown): value is WireDevice {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name_ciphertext" in value &&
    typeof value.name_ciphertext === "string" &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    "is_current" in value &&
    typeof value.is_current === "boolean"
  );
}

function fromWire(device: WireDevice): RegisteredDevice {
  return {
    id: device.id,
    nameCiphertext: device.name_ciphertext,
    createdAt: device.created_at,
    lastSyncAt: device.last_sync_at ?? undefined,
    revoked: (device.revoked_at ?? null) !== null,
    isCurrent: device.is_current,
  };
}

/** The device register held by the Warmly API. */
export class ApiDeviceRegistry implements DeviceRegistry {
  readonly #api: ApiClient;

  /** @param api - The API client. */
  constructor(api: ApiClient) {
    this.#api = api;
  }

  async register(
    session: AuthSession,
    identity: DeviceIdentity,
    registration: DeviceRegistration,
  ): Promise<boolean> {
    const body: WireRegistration = {
      device_id: identity.deviceId,
      public_key: identity.publicKey,
      name_ciphertext: registration.nameCiphertext,
      enrollment_proof: registration.enrollmentProof,
    };
    // Signed by the very key being registered: proof of holding it.
    const response = await this.#api.send(session, {
      method: "POST",
      path: PATH,
      body,
      signedBy: identity,
    });
    if (response.status === 409) {
      const problem: unknown = await response.json().catch(() => undefined);
      const code =
        typeof problem === "object" && problem !== null && "code" in problem
          ? problem.code
          : undefined;
      if (code === "device.already_registered") {
        return false;
      }
    }
    if (!response.ok) {
      throw new ApiError("unexpected");
    }
    return true;
  }

  async list(
    session: AuthSession,
    identity: DeviceIdentity,
  ): Promise<RegisteredDevice[]> {
    const response = await this.#api.send(session, {
      method: "GET",
      path: PATH,
      signedBy: identity,
    });
    const body: unknown = response.ok ? await response.json() : undefined;
    const devices =
      typeof body === "object" && body !== null && "devices" in body
        ? body.devices
        : undefined;
    if (!Array.isArray(devices) || !devices.every(isWireDevice)) {
      throw new ApiError("unexpected");
    }
    return devices.map(fromWire);
  }

  async rename(
    session: AuthSession,
    identity: DeviceIdentity,
    deviceId: string,
    nameCiphertext: string,
  ): Promise<boolean> {
    const body: WireRename = { name_ciphertext: nameCiphertext };
    const response = await this.#api.send(session, {
      method: "PATCH",
      path: `${PATH}/${encodeURIComponent(deviceId)}`,
      body,
      signedBy: identity,
    });
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new ApiError("unexpected");
    }
    return true;
  }

  async revoke(
    session: AuthSession,
    identity: DeviceIdentity,
    deviceId: string,
  ): Promise<boolean> {
    const response = await this.#api.send(session, {
      method: "POST",
      path: `${PATH}/${encodeURIComponent(deviceId)}/revoke`,
      signedBy: identity,
    });
    if (response.status === 404) {
      return false;
    }
    if (response.status === 403) {
      throw new ApiError("reauthentication_required");
    }
    if (!response.ok) {
      throw new ApiError("unexpected");
    }
    return true;
  }
}
