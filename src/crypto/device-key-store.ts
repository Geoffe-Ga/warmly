/**
 * Where a trusted device keeps what it needs to unlock without the recovery
 * key (ADR-0004, PRD DEV-005, DEV-006).
 *
 * The root key is stored wrapped twice:
 *
 * ```
 * stored = AES-256-GCM( device key , AES-256-GCM( passphrase key , root key ) )
 * ```
 *
 * - The **device key** is generated here, is non-extractable, and lives in
 *   IndexedDB as a key object. Script cannot read its bytes, so a copy of the
 *   stored record made without the browser's key store opens nothing.
 * - The **passphrase key** is derived from a passphrase the user sets for this
 *   device, with PBKDF2-HMAC-SHA-256. It is never stored. Without it, holding
 *   the unlocked phone is not enough to open the journal, which is what makes
 *   the lock more than cosmetic.
 *
 * Nothing that can decrypt is ever written to `localStorage` (SYNC-001). The
 * account password is not involved.
 */
import { concat, lengthPrefixed, utf8 } from "./encoding";
import { ROOT_KEY_BYTES } from "./root-key";

/**
 * PBKDF2-HMAC-SHA-256 iterations, per the OWASP Password Storage Cheat Sheet
 * recommendation current when this was written. Stored with each record, so
 * it can be raised later without stranding existing devices.
 */
export const PBKDF2_ITERATIONS = 600_000;
/** Shortest device passphrase accepted. */
export const MIN_DEVICE_PASSPHRASE_LENGTH = 12;
/**
 * Wrong passphrases in a row before this device stops being trusted. The
 * record is then removed and the recovery key is needed. Nothing is lost,
 * and someone holding the locked device cannot keep guessing on its screen.
 */
export const MAX_FAILED_UNLOCKS = 5;
/** Iteration counts outside this range mark a record as damaged. */
const MIN_ACCEPTED_ITERATIONS = 100_000;
const MAX_ACCEPTED_ITERATIONS = 10_000_000;
/** The device-record format this code writes. */
export const DEVICE_FORMAT_VERSION = 1;

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const STORE = "device-keys";

/** The passphrase did not open the device's stored key. */
export class DevicePassphraseError extends Error {
  constructor() {
    super("The device passphrase did not open the stored key");
    this.name = "DevicePassphraseError";
  }
}

/**
 * Too many wrong passphrases in a row. The device's record has been removed,
 * and unlocking now takes the recovery key.
 */
export class DeviceLockedOutError extends Error {
  constructor() {
    super("Too many wrong passphrases; the device is no longer trusted");
    this.name = "DeviceLockedOutError";
  }
}

/** The device's stored key is missing a part or was written by newer code. */
export class DeviceStoreDamagedError extends Error {
  constructor() {
    super("The device's stored key cannot be used");
    this.name = "DeviceStoreDamagedError";
  }
}

/** Keeps root-key material for accounts on this device. */
export interface DeviceKeyStore {
  /** Whether this device can unlock the account without the recovery key. */
  has(userId: string): Promise<boolean>;
  /**
   * Make this device trusted for the account.
   *
   * @param userId - The account.
   * @param rootKeyBytes - The 32 bytes of root-key material.
   * @param passphrase - The passphrase that will unlock this device.
   */
  enrol(
    userId: string,
    rootKeyBytes: Uint8Array<ArrayBuffer>,
    passphrase: string,
  ): Promise<void>;
  /**
   * Recover the root-key material with the device passphrase.
   *
   * @throws DevicePassphraseError if the passphrase is wrong.
   * @throws DeviceLockedOutError if that was one wrong passphrase too many;
   *   the record has been removed.
   * @throws DeviceStoreDamagedError if there is no usable record.
   */
  open(userId: string, passphrase: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Stop trusting this device for the account. */
  forget(userId: string): Promise<void>;
}

/** One account's record, as kept in IndexedDB. */
interface DeviceRecord {
  readonly version: number;
  readonly deviceKey: CryptoKey;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly iterations: number;
  readonly outerNonce: Uint8Array<ArrayBuffer>;
  readonly innerNonce: Uint8Array<ArrayBuffer>;
  readonly wrapped: Uint8Array<ArrayBuffer>;
  /** Wrong passphrases since the last successful unlock. */
  readonly failedUnlocks: number;
}

// Values read back from IndexedDB are checked by shape, not with
// `instanceof`: a structured clone can come from another realm, where the
// constructors are different objects.
function isBytes(value: unknown): value is Uint8Array<ArrayBuffer> {
  return (
    ArrayBuffer.isView(value) &&
    "BYTES_PER_ELEMENT" in value &&
    value.BYTES_PER_ELEMENT === 1
  );
}

function isKey(value: unknown): value is CryptoKey {
  return (
    typeof value === "object" &&
    value !== null &&
    "algorithm" in value &&
    "extractable" in value &&
    "usages" in value
  );
}

function isCount(value: unknown, least: number, most: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= least &&
    value <= most
  );
}

function isRecord(
  value: unknown,
  leastIterations: number,
): value is DeviceRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<Record<keyof DeviceRecord, unknown>>;
  return (
    record.version === DEVICE_FORMAT_VERSION &&
    isKey(record.deviceKey) &&
    isBytes(record.salt) &&
    // A record claiming too few iterations would make guessing cheap; one
    // claiming an absurd number would hang the unlock. Both are refused.
    isCount(record.iterations, leastIterations, MAX_ACCEPTED_ITERATIONS) &&
    isCount(record.failedUnlocks, 0, MAX_FAILED_UNLOCKS) &&
    isBytes(record.outerNonce) &&
    isBytes(record.innerNonce) &&
    isBytes(record.wrapped)
  );
}

function associatedData(userId: string): Uint8Array<ArrayBuffer> {
  return concat(
    utf8("warmly/device-key/"),
    new Uint8Array([DEVICE_FORMAT_VERSION]),
    lengthPrefixed("owner", userId),
  );
}

async function passphraseKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    // NFKC, so the same passphrase typed on different keyboards matches.
    utf8(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => {
      resolve(source.result);
    };
    source.onerror = () => {
      reject(source.error ?? new Error("IndexedDB request failed"));
    };
  });
}

/** The device key store, in IndexedDB. */
export class IndexedDbDeviceKeyStore implements DeviceKeyStore {
  readonly #databaseName: string;
  readonly #iterations: number;

  /**
   * @param databaseName - The IndexedDB database to use.
   * @param iterations - PBKDF2 iterations for new records. Tests lower it;
   *   everything else uses the default.
   */
  constructor(
    databaseName = "warmly-device",
    iterations: number = PBKDF2_ITERATIONS,
  ) {
    this.#databaseName = databaseName;
    this.#iterations = iterations;
  }

  async #run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const opening = indexedDB.open(this.#databaseName, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(STORE);
    };
    const database = await request(opening);
    try {
      return await request(
        work(database.transaction(STORE, mode).objectStore(STORE)),
      );
    } finally {
      database.close();
    }
  }

  async #read(userId: string): Promise<DeviceRecord | undefined> {
    const value: unknown = await this.#run("readonly", (store) =>
      store.get(userId),
    );
    if (value === undefined) {
      return undefined;
    }
    // A store built with fewer iterations (tests only) accepts its own.
    const least = Math.min(this.#iterations, MIN_ACCEPTED_ITERATIONS);
    if (!isRecord(value, least)) {
      throw new DeviceStoreDamagedError();
    }
    return value;
  }

  async has(userId: string): Promise<boolean> {
    try {
      return (await this.#read(userId)) !== undefined;
    } catch (error) {
      if (error instanceof DeviceStoreDamagedError) {
        return false;
      }
      throw error;
    }
  }

  async enrol(
    userId: string,
    rootKeyBytes: Uint8Array<ArrayBuffer>,
    passphrase: string,
  ): Promise<void> {
    if (rootKeyBytes.length !== ROOT_KEY_BYTES) {
      throw new Error(
        `Root key material must be ${String(ROOT_KEY_BYTES)} bytes`,
      );
    }
    if (passphrase.length < MIN_DEVICE_PASSPHRASE_LENGTH) {
      throw new Error("The device passphrase is too short");
    }
    const additionalData = associatedData(userId);
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const innerNonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const outerNonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const deviceKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const inner = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: innerNonce, additionalData },
      await passphraseKey(passphrase, salt, this.#iterations),
      rootKeyBytes,
    );
    const wrapped = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: outerNonce, additionalData },
      deviceKey,
      inner,
    );
    const record: DeviceRecord = {
      version: DEVICE_FORMAT_VERSION,
      deviceKey,
      salt,
      iterations: this.#iterations,
      outerNonce,
      innerNonce,
      wrapped: new Uint8Array(wrapped),
      failedUnlocks: 0,
    };
    await this.#put(userId, record);
  }

  async open(
    userId: string,
    passphrase: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const record = await this.#read(userId);
    if (record === undefined) {
      throw new DeviceStoreDamagedError();
    }
    const additionalData = associatedData(userId);
    let inner: ArrayBuffer;
    try {
      inner = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.outerNonce, additionalData },
        record.deviceKey,
        record.wrapped,
      );
    } catch {
      // The outer layer does not depend on the passphrase, so a failure here
      // means the record itself is unusable.
      throw new DeviceStoreDamagedError();
    }
    try {
      const rootKeyBytes = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.innerNonce, additionalData },
        await passphraseKey(passphrase, record.salt, record.iterations),
        inner,
      );
      if (record.failedUnlocks > 0) {
        await this.#put(userId, { ...record, failedUnlocks: 0 });
      }
      return new Uint8Array(rootKeyBytes);
    } catch {
      // A failure here is almost always a wrong passphrase. A damaged inner
      // layer looks the same; either way the count below ends the guessing
      // and hands over to the recovery key.
      const failedUnlocks = record.failedUnlocks + 1;
      if (failedUnlocks >= MAX_FAILED_UNLOCKS) {
        await this.forget(userId);
        throw new DeviceLockedOutError();
      }
      await this.#put(userId, { ...record, failedUnlocks });
      throw new DevicePassphraseError();
    }
  }

  async #put(userId: string, record: DeviceRecord): Promise<void> {
    await this.#run("readwrite", (store) => store.put(record, userId));
  }

  async forget(userId: string): Promise<void> {
    await this.#run("readwrite", (store) => store.delete(userId));
  }
}
