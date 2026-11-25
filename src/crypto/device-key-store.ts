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
    "type" in value &&
    value.type === "secret" &&
    "algorithm" in value &&
    typeof value.algorithm === "object" &&
    value.algorithm !== null &&
    "name" in value.algorithm &&
    value.algorithm.name === "AES-GCM" &&
    "extractable" in value &&
    value.extractable === false
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

  /**
   * Run one transaction. `work` may queue further requests from inside a
   * request callback; the promise settles when the whole transaction has
   * committed, or rejects if it aborts (for example when storage is full).
   */
  async #run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, result: (value: T) => void) => void,
  ): Promise<T> {
    const opening = indexedDB.open(this.#databaseName, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(STORE);
    };
    const database = await request(opening);
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        let value: T | undefined;
        let produced = false;
        transaction.oncomplete = () => {
          if (produced) {
            resolve(value as T);
          } else {
            reject(new Error("The IndexedDB transaction produced no result"));
          }
        };
        const fail = (): void => {
          reject(
            transaction.error ?? new Error("IndexedDB transaction failed"),
          );
        };
        transaction.onabort = fail;
        transaction.onerror = fail;
        work(transaction.objectStore(STORE), (produced_) => {
          value = produced_;
          produced = true;
        });
      });
    } finally {
      database.close();
    }
  }

  #isUsable(value: unknown): value is DeviceRecord {
    // A store built with fewer iterations (tests only) accepts its own.
    const least = Math.min(this.#iterations, MIN_ACCEPTED_ITERATIONS);
    return isRecord(value, least);
  }

  async #read(userId: string): Promise<DeviceRecord | undefined> {
    const value = await this.#run<unknown>("readonly", (store, result) => {
      const reading = store.get(userId);
      reading.onsuccess = () => {
        result(reading.result);
      };
    });
    if (value === undefined) {
      return undefined;
    }
    if (!this.#isUsable(value)) {
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
    // Measured as it will be used: after normalisation.
    if (passphrase.normalize("NFKC").length < MIN_DEVICE_PASSPHRASE_LENGTH) {
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

  /**
   * Count an unlock attempt before it is tried, in one transaction, so that
   * simultaneous attempts (a double submit, or two tabs) each count, and an
   * attempt that is abandoned part-way still counts.
   *
   * @returns The record as it was, or what is wrong with it.
   */
  async #beginAttempt(
    userId: string,
  ): Promise<DeviceRecord | "missing" | "damaged" | "locked_out"> {
    return this.#run("readwrite", (store, result) => {
      const reading = store.get(userId);
      reading.onsuccess = () => {
        const value: unknown = reading.result;
        if (value === undefined) {
          result("missing");
        } else if (!this.#isUsable(value)) {
          result("damaged");
        } else if (value.failedUnlocks >= MAX_FAILED_UNLOCKS) {
          store.delete(userId);
          result("locked_out");
        } else {
          store.put(
            { ...value, failedUnlocks: value.failedUnlocks + 1 },
            userId,
          );
          result(value);
        }
      };
    });
  }

  /** Set the count back to zero, in one transaction. */
  async #clearAttempts(userId: string): Promise<void> {
    await this.#run<true>("readwrite", (store, result) => {
      const reading = store.get(userId);
      reading.onsuccess = () => {
        const current: unknown = reading.result;
        if (this.#isUsable(current)) {
          store.put({ ...current, failedUnlocks: 0 }, userId);
        }
        result(true);
      };
    });
  }

  async open(
    userId: string,
    passphrase: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const record = await this.#beginAttempt(userId);
    if (record === "locked_out") {
      throw new DeviceLockedOutError();
    }
    if (record === "missing" || record === "damaged") {
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
    let rootKeyBytes: ArrayBuffer;
    try {
      rootKeyBytes = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.innerNonce, additionalData },
        await passphraseKey(passphrase, record.salt, record.iterations),
        inner,
      );
    } catch {
      // A failure here is almost always a wrong passphrase. A damaged inner
      // layer looks the same; either way the count ends the guessing and
      // hands over to the recovery key. The attempt was already counted.
      if (record.failedUnlocks + 1 >= MAX_FAILED_UNLOCKS) {
        await this.forget(userId);
        throw new DeviceLockedOutError();
      }
      throw new DevicePassphraseError();
    }
    // The passphrase was right. Clearing the count is tidying up: if it
    // cannot be written, the unlock still succeeds, and the count is cleared
    // by the next successful unlock instead.
    await this.#clearAttempts(userId).catch(() => undefined);
    return new Uint8Array(rootKeyBytes);
  }

  async #put(userId: string, record: DeviceRecord): Promise<void> {
    await this.#run<true>("readwrite", (store, result) => {
      store.put(record, userId);
      result(true);
    });
  }

  async forget(userId: string): Promise<void> {
    await this.#run<true>("readwrite", (store, result) => {
      store.delete(userId);
      result(true);
    });
  }
}
