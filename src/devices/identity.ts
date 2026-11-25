/**
 * This device's cryptographic identity (ADR-0005, PRD DEV-002).
 *
 * An ECDSA P-256 key pair, generated on the device. The private key is
 * non-extractable and is kept in IndexedDB as a key object: script can sign
 * with it but cannot read it. One identity per account on a device, so two
 * accounts used in the same browser are not linkable by a shared key.
 */
import { toBase64 } from "../crypto/encoding";

const STORE = "identities";
const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNING = { name: "ECDSA", hash: "SHA-256" } as const;

/** A device identity that can sign. */
export interface DeviceIdentity {
  /** The device's ID: a random UUID, registered with the server. */
  readonly deviceId: string;
  /** The public key: a base64 uncompressed P-256 point. */
  readonly publicKey: string;
  /** Whether the server has accepted this identity. */
  readonly registered: boolean;
  /**
   * Sign a message.
   *
   * @returns The 64-byte signature (`r || s`), base64.
   */
  sign(message: Uint8Array<ArrayBuffer>): Promise<string>;
}

/** Keeps this device's identity for each account. */
export interface DeviceIdentityStore {
  /** @returns The account's identity on this device, if it has one. */
  get(userId: string): Promise<DeviceIdentity | undefined>;
  /** @returns The account's identity, created now if there was none. */
  getOrCreate(userId: string): Promise<DeviceIdentity>;
  /** Record that the server has accepted the account's identity. */
  markRegistered(userId: string): Promise<void>;
  /**
   * Delete the account's identity from this device, private key included.
   * A device that registers again afterwards does so as a new device.
   */
  forget(userId: string): Promise<void>;
}

/** One account's identity, as kept in IndexedDB. */
interface IdentityRecord {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly privateKey: CryptoKey;
  readonly registered: boolean;
}

/** Whether a stored value is a signing key that script cannot read. */
function isSealedSigningKey(handle: unknown): boolean {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "type" in handle &&
    handle.type === "private" &&
    "extractable" in handle &&
    handle.extractable === false
  );
}

// Checked by shape: a structured clone can come from another realm.
function isRecord(value: unknown): value is IdentityRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "deviceId" in value &&
    typeof value.deviceId === "string" &&
    "publicKey" in value &&
    typeof value.publicKey === "string" &&
    "registered" in value &&
    typeof value.registered === "boolean" &&
    "privateKey" in value &&
    isSealedSigningKey(value.privateKey)
  );
}

function identity(record: IdentityRecord): DeviceIdentity {
  return {
    deviceId: record.deviceId,
    publicKey: record.publicKey,
    registered: record.registered,
    sign: async (message) =>
      toBase64(
        new Uint8Array(
          await crypto.subtle.sign(SIGNING, record.privateKey, message),
        ),
      ),
  };
}

/** The identity store, in IndexedDB. */
export class IndexedDbDeviceIdentityStore implements DeviceIdentityStore {
  readonly #databaseName: string;

  /** @param databaseName - The IndexedDB database to use. */
  constructor(databaseName = "warmly-identity") {
    this.#databaseName = databaseName;
  }

  /** Run one transaction; settle when it has committed or aborted. */
  async #run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, result: (value: T) => void) => void,
  ): Promise<T> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(this.#databaseName, 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore(STORE);
      };
      opening.onsuccess = () => {
        resolve(opening.result);
      };
      opening.onerror = () => {
        reject(opening.error ?? new Error("IndexedDB could not be opened"));
      };
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        let value: T | undefined;
        transaction.oncomplete = () => {
          resolve(value as T);
        };
        const fail = (): void => {
          reject(
            transaction.error ?? new Error("IndexedDB transaction failed"),
          );
        };
        transaction.onabort = fail;
        transaction.onerror = fail;
        work(transaction.objectStore(STORE), (produced) => {
          value = produced;
        });
      });
    } finally {
      database.close();
    }
  }

  async #read(userId: string): Promise<IdentityRecord | undefined> {
    const value = await this.#run<unknown>("readonly", (store, result) => {
      const reading = store.get(userId);
      reading.onsuccess = () => {
        result(reading.result);
      };
    });
    // A record that cannot be used is treated as absent: the device makes a
    // new identity and registers again, which needs the account root key.
    return isRecord(value) ? value : undefined;
  }

  async get(userId: string): Promise<DeviceIdentity | undefined> {
    const record = await this.#read(userId);
    return record === undefined ? undefined : identity(record);
  }

  async getOrCreate(userId: string): Promise<DeviceIdentity> {
    const existing = await this.#read(userId);
    if (existing !== undefined) {
      return identity(existing);
    }
    const pair = await crypto.subtle.generateKey(ALGORITHM, false, [
      "sign",
      "verify",
    ]);
    const fresh: IdentityRecord = {
      deviceId: crypto.randomUUID(),
      publicKey: toBase64(
        new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      ),
      privateKey: pair.privateKey,
      registered: false,
    };
    // Written only if no identity appeared meanwhile, so two tabs starting
    // at once end up sharing one identity.
    const kept = await this.#run<unknown>("readwrite", (store, result) => {
      const reading = store.get(userId);
      reading.onsuccess = () => {
        if (isRecord(reading.result)) {
          result(reading.result);
        } else {
          store.put(fresh, userId);
          result(fresh);
        }
      };
    });
    return identity(kept as IdentityRecord);
  }

  async markRegistered(userId: string): Promise<void> {
    await this.#run<true>("readwrite", (store, result) => {
      const reading = store.get(userId);
      reading.onsuccess = () => {
        if (isRecord(reading.result)) {
          store.put({ ...reading.result, registered: true }, userId);
        }
        result(true);
      };
    });
  }

  async forget(userId: string): Promise<void> {
    await this.#run<true>("readwrite", (store, result) => {
      store.delete(userId);
      result(true);
    });
  }
}
