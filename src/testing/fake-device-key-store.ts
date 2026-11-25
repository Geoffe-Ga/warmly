/**
 * Stand-in for a trusted device's key store, for development and the `e2e`
 * build, so "lock, then unlock on this device" can be shown before the real
 * store exists (issue #20). It must never be part of a production build.
 *
 * It keeps root-key material unprotected in `sessionStorage`. That is
 * acceptable only because every key in these builds is synthetic and protects
 * nothing: the accounts, the "server" and the journal are all in-memory
 * doubles. The real store never holds raw key material.
 */
import type { DeviceKeyStore } from "../crypto/device-key-store";
import { fromBase64, toBase64 } from "../crypto/encoding";

/** Storage key for the fake device store. */
export const FAKE_DEVICE_KEY_STORAGE_KEY = "warmly.fake.device-keys";

type Stored = [userId: string, rootKey: string][];

/** See the module comment. */
export class FakeDeviceKeyStore implements DeviceKeyStore {
  readonly #storage: Storage;

  constructor(storage: Storage = sessionStorage) {
    this.#storage = storage;
  }

  #all(): Stored {
    const raw = this.#storage.getItem(FAKE_DEVICE_KEY_STORAGE_KEY);
    return raw === null ? [] : (JSON.parse(raw) as Stored);
  }

  load(userId: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const found = this.#all().find(([id]) => id === userId);
    return Promise.resolve(
      found === undefined ? undefined : fromBase64(found[1]),
    );
  }

  save(userId: string, rootKeyBytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const others = this.#all().filter(([id]) => id !== userId);
    others.push([userId, toBase64(rootKeyBytes)]);
    this.#storage.setItem(FAKE_DEVICE_KEY_STORAGE_KEY, JSON.stringify(others));
    return Promise.resolve();
  }
}
