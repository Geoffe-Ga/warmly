/**
 * Registering this device and listing the account's devices (PRD DEV-002,
 * DEV-003; ADR-0005).
 *
 * This is where device names are encrypted and decrypted. A name is user
 * content: it is sealed with the account root key and bound to the device it
 * names, so the server cannot read it or move it to another device.
 */
import type { AuthClient, AuthSession } from "../auth/auth-client";
import { fromBase64, toBase64 } from "../crypto/encoding";
import { openJson, sealJson, type RecordContext } from "../crypto/envelope";
import type { RootKey } from "../crypto/root-key";
import type { DeviceIdentity, DeviceIdentityStore } from "./identity";
import type { DeviceRegistry } from "./registry";
import { enrollmentProof } from "./signing";

/** The record type of a device name in the envelope's associated data. */
export const DEVICE_NAME_RECORD_TYPE = 16;
/** Longest device name accepted, in characters. */
export const MAX_DEVICE_NAME_LENGTH = 60;

/** One of the account's devices, ready to show. */
export interface DeviceView {
  readonly id: string;
  /** The name, or `undefined` if it could not be decrypted on this device. */
  readonly name: string | undefined;
  readonly createdAt: Date;
  readonly lastSyncAt: Date | undefined;
  readonly isCurrent: boolean;
  readonly revoked: boolean;
}

/** Why a device operation could not be done. */
export type DeviceErrorCode = "locked" | "not_found" | "invalid_name";

/** A device operation failed for a reason the UI can explain. */
export class DeviceError extends Error {
  readonly code: DeviceErrorCode;

  constructor(code: DeviceErrorCode) {
    super(`Device operation failed: ${code}`);
    this.name = "DeviceError";
    this.code = code;
  }
}

/** What the Manage Devices screen needs. */
export interface DeviceDirectory {
  /** @returns The account's own devices, oldest first. */
  list(): Promise<DeviceView[]>;
  /**
   * Give a device a new name.
   *
   * @throws DeviceError `invalid_name`, `not_found` or `locked`.
   */
  rename(deviceId: string, name: string): Promise<void>;
}

function nameContext(owner: string, deviceId: string): RecordContext {
  return { owner, recordId: deviceId, type: DEVICE_NAME_RECORD_TYPE };
}

/**
 * The name a device gets when it registers. The user can change it.
 *
 * @param now - The current time.
 * @param format - How to write the date. The default is the long date in
 *   the device's own language and time zone, which is how Manage Devices
 *   writes dates too.
 * @returns A name such as "Device added November 25, 2026".
 */
export function defaultDeviceName(
  now: Date,
  format: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }),
): string {
  return `Device added ${format.format(now)}`;
}

/**
 * Tidy a device name and check it.
 *
 * @param name - What the user typed.
 * @returns The trimmed name, or `undefined` if it is empty or too long.
 */
export function cleanDeviceName(name: string): string | undefined {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed === "" || [...trimmed].length > MAX_DEVICE_NAME_LENGTH
    ? undefined
    : trimmed;
}

/** This device, and the account's devices as seen from it. */
export class AccountDevices implements DeviceDirectory {
  readonly #auth: AuthClient;
  readonly #identities: DeviceIdentityStore;
  readonly #registry: DeviceRegistry;
  readonly #rootKey: () => RootKey | undefined;
  readonly #now: () => Date;
  #registering: Promise<void> | undefined;

  /**
   * @param auth - Says who is signed in.
   * @param identities - This device's identity for each account.
   * @param registry - The server's register of devices.
   * @param rootKey - The account root key while unlocked, else `undefined`.
   * @param now - The current time; tests pass their own.
   */
  constructor(
    auth: AuthClient,
    identities: DeviceIdentityStore,
    registry: DeviceRegistry,
    rootKey: () => RootKey | undefined,
    now: () => Date = () => new Date(),
  ) {
    this.#auth = auth;
    this.#identities = identities;
    this.#registry = registry;
    this.#rootKey = rootKey;
    this.#now = now;
  }

  async #unlocked(): Promise<{ session: AuthSession; root: RootKey }> {
    const session = await this.#auth.currentSession();
    const root = this.#rootKey();
    if (session === undefined || root === undefined) {
      throw new DeviceError("locked");
    }
    return { session, root };
  }

  /**
   * Make sure this device is registered for the signed-in account. It needs
   * the root key, both to prove the device may register and to encrypt its
   * name. A registration that was interrupted is completed the next time.
   *
   * @param root - The account root key.
   */
  async ensureRegistered(root: RootKey): Promise<void> {
    // One attempt at a time: unlocking and opening Manage Devices can both
    // ask at once.
    this.#registering ??= this.#register(root).finally(() => {
      this.#registering = undefined;
    });
    await this.#registering;
  }

  /**
   * Register after an unlock without making the unlock wait for the network.
   * A failure is left for the next unlock, or for the next time the device
   * list is opened, which reports it.
   *
   * @param root - The account root key.
   */
  registerInBackground(root: RootKey): void {
    this.ensureRegistered(root).catch(() => undefined);
  }

  async #register(root: RootKey): Promise<void> {
    const session = await this.#auth.currentSession();
    if (session === undefined) {
      return;
    }
    const identity = await this.#identities.getOrCreate(session.userId);
    if (identity.registered) {
      return;
    }
    const name = await sealJson(
      root,
      nameContext(session.userId, identity.deviceId),
      defaultDeviceName(this.#now()),
    );
    // "Already registered" is this device finishing an earlier attempt.
    await this.#registry.register(session, identity, {
      nameCiphertext: toBase64(name),
      enrollmentProof: await enrollmentProof(
        root,
        identity.deviceId,
        identity.publicKey,
      ),
    });
    await this.#identities.markRegistered(session.userId);
  }

  /** The session, root key and registered identity every request needs. */
  async #ready(): Promise<{
    session: AuthSession;
    root: RootKey;
    identity: DeviceIdentity;
  }> {
    const { session, root } = await this.#unlocked();
    await this.ensureRegistered(root);
    const identity = await this.#identities.getOrCreate(session.userId);
    return { session, root, identity };
  }

  async list(): Promise<DeviceView[]> {
    const { session, root, identity } = await this.#ready();
    const devices = await this.#registry.list(session, identity);
    return Promise.all(
      devices.map(async (device) => ({
        id: device.id,
        name: await this.#openName(root, session.userId, device),
        createdAt: new Date(device.createdAt),
        lastSyncAt:
          device.lastSyncAt === undefined
            ? undefined
            : new Date(device.lastSyncAt),
        isCurrent: device.isCurrent,
        revoked: device.revoked,
      })),
    );
  }

  /** Decrypt a name. A name that does not open is shown as unnamed. */
  async #openName(
    root: RootKey,
    owner: string,
    device: { readonly id: string; readonly nameCiphertext: string },
  ): Promise<string | undefined> {
    try {
      const name = await openJson(
        root,
        nameContext(owner, device.id),
        fromBase64(device.nameCiphertext),
      );
      return typeof name === "string" ? cleanDeviceName(name) : undefined;
    } catch {
      return undefined;
    }
  }

  async rename(deviceId: string, name: string): Promise<void> {
    const cleaned = cleanDeviceName(name);
    if (cleaned === undefined) {
      throw new DeviceError("invalid_name");
    }
    const { session, root, identity } = await this.#ready();
    const sealed = await sealJson(
      root,
      nameContext(session.userId, deviceId),
      cleaned,
    );
    const renamed = await this.#registry.rename(
      session,
      identity,
      deviceId,
      toBase64(sealed),
    );
    if (!renamed) {
      throw new DeviceError("not_found");
    }
  }
}

/** Stand-in for builds with no backend configured: there are no devices. */
export class UnavailableDeviceDirectory implements DeviceDirectory {
  list(): Promise<DeviceView[]> {
    return Promise.resolve([]);
  }

  rename(): Promise<void> {
    return Promise.reject(new DeviceError("locked"));
  }
}
