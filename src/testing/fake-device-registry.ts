/**
 * In-memory stand-in for the Warmly API's device register, for development
 * and the `e2e` build. It must never be part of a production build.
 *
 * It keeps the devices in `localStorage`, playing the part of the server, so
 * a second tab sees the first tab's device as another device on the account.
 * It applies the same ownership rules as the real API: an account sees and
 * renames only its own devices, and a device ID can be registered once.
 *
 * It does not check signatures or enrollment proofs. Those are covered by
 * the API's own tests and by a fixture both sides verify.
 */
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
][];

/** See the module comment. */
export class FakeDeviceRegistry implements DeviceRegistry {
  readonly #storage: Storage;
  readonly #now: () => Date;

  constructor(
    storage: Storage = localStorage,
    now: () => Date = () => new Date(),
  ) {
    this.#storage = storage;
    this.#now = now;
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

  list(
    session: AuthSession,
    identity: DeviceIdentity,
  ): Promise<RegisteredDevice[]> {
    return Promise.resolve(
      this.#all()
        .filter(([owner]) => owner === session.userId)
        .map(([, id, nameCiphertext, createdAt]) => ({
          id,
          nameCiphertext,
          createdAt,
          lastSyncAt: undefined,
          revoked: false,
          isCurrent: id === identity.deviceId,
        })),
    );
  }

  rename(
    session: AuthSession,
    _identity: DeviceIdentity,
    deviceId: string,
    nameCiphertext: string,
  ): Promise<boolean> {
    const all = this.#all();
    const device = all.find(
      ([owner, id]) => owner === session.userId && id === deviceId,
    );
    if (device === undefined) {
      return Promise.resolve(false);
    }
    device[2] = nameCiphertext;
    this.#save(all);
    return Promise.resolve(true);
  }
}
