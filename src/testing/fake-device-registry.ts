/**
 * In-memory stand-in for the Warmly API's device register, for development
 * and the `e2e` build. It must never be part of a production build.
 *
 * It keeps the devices in `localStorage`, playing the part of the server, so
 * a second tab sees the first tab's device as another device on the account.
 * It applies the same ownership rules as the real API: an account sees and
 * renames only its own devices, a device ID can be registered once, and a
 * revoked device is refused from then on and can never register again.
 * It does not check that a password was entered recently before a
 * revocation; `AccountDevices` asks the auth client for that first.
 *
 * It does not check signatures or enrollment proofs. Those are covered by
 * the API's own tests and by a fixture both sides verify.
 */
import { ApiError } from "../api/client";
import type { AuthSession } from "../auth/auth-client";
import type { DeviceIdentity } from "../devices/identity";
import type {
  DeviceRegistration,
  DeviceRegistry,
  RegisteredDevice,
} from "../devices/registry";

/** Storage key for the fake server's devices. */
export const FAKE_DEVICES_STORAGE_KEY = "warmly.fake.server.devices";

type Stored = [
  owner: string,
  id: string,
  nameCiphertext: string,
  createdAt: string,
  revoked?: boolean,
][];

/** See the module comment. */
export class FakeDeviceRegistry implements DeviceRegistry {
  readonly #storage: Storage;
  readonly #now: () => Date;
  readonly #onDeviceRevoked: () => void;

  /**
   * @param storage - Where the fake server keeps its devices.
   * @param now - The current time; tests pass their own.
   * @param onDeviceRevoked - Called when a revoked device makes a request,
   *   as the real API client does.
   */
  constructor(
    storage: Storage = localStorage,
    now: () => Date = () => new Date(),
    onDeviceRevoked: () => void = () => undefined,
  ) {
    this.#storage = storage;
    this.#now = now;
    this.#onDeviceRevoked = onDeviceRevoked;
  }

  /** Refuse a request from a revoked device, as the server does. */
  #refuseRevoked(all: Stored, identity: DeviceIdentity): void {
    if (
      all.some(([, id, , , revoked]) => id === identity.deviceId && revoked)
    ) {
      this.#onDeviceRevoked();
      throw new ApiError("device_revoked");
    }
  }

  #all(): Stored {
    const raw = this.#storage.getItem(FAKE_DEVICES_STORAGE_KEY);
    return raw === null ? [] : (JSON.parse(raw) as Stored);
  }

  #save(all: Stored): void {
    this.#storage.setItem(FAKE_DEVICES_STORAGE_KEY, JSON.stringify(all));
  }

  register(
    session: AuthSession,
    identity: DeviceIdentity,
    registration: DeviceRegistration,
  ): Promise<boolean> {
    const all = this.#all();
    if (all.some(([, id]) => id === identity.deviceId)) {
      return Promise.resolve(false);
    }
    all.push([
      session.userId,
      identity.deviceId,
      registration.nameCiphertext,
      this.#now().toISOString(),
    ]);
    this.#save(all);
    return Promise.resolve(true);
  }

  // Each method below is `async` so that a refusal is a rejected promise,
  // as it is from the real register.
  async list(
    session: AuthSession,
    identity: DeviceIdentity,
  ): Promise<RegisteredDevice[]> {
    const all = await Promise.resolve(this.#all());
    this.#refuseRevoked(all, identity);
    return all
      .filter(([owner]) => owner === session.userId)
      .map(([, id, nameCiphertext, createdAt, revoked]) => ({
        id,
        nameCiphertext,
        createdAt,
        lastSyncAt: undefined,
        revoked: revoked === true,
        isCurrent: id === identity.deviceId,
      }));
  }

  async revoke(
    session: AuthSession,
    identity: DeviceIdentity,
    deviceId: string,
  ): Promise<boolean> {
    const all = await Promise.resolve(this.#all());
    this.#refuseRevoked(all, identity);
    const device = all.find(
      ([owner, id]) => owner === session.userId && id === deviceId,
    );
    if (device === undefined) {
      return false;
    }
    device[4] = true;
    this.#save(all);
    return true;
  }

  async rename(
    session: AuthSession,
    identity: DeviceIdentity,
    deviceId: string,
    nameCiphertext: string,
  ): Promise<boolean> {
    const all = await Promise.resolve(this.#all());
    this.#refuseRevoked(all, identity);
    const device = all.find(
      ([owner, id]) => owner === session.userId && id === deviceId,
    );
    if (device === undefined) {
      return false;
    }
    device[2] = nameCiphertext;
    this.#save(all);
    return true;
  }
}
