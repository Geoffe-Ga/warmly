import { describe, expect, it } from "vitest";

import {
  DEVICE_FORMAT_VERSION,
  DevicePassphraseError,
  DeviceStoreDamagedError,
  IndexedDbDeviceKeyStore,
  MIN_DEVICE_PASSPHRASE_LENGTH,
  PBKDF2_ITERATIONS,
} from "../../../src/crypto/device-key-store";
import { toBase64 } from "../../../src/crypto/encoding";
import { generateRootKeyBytes } from "../../../src/crypto/root-key";

const USER = "0a1b2c3d-0000-4000-8000-00000000000a";
const OTHER_USER = "0a1b2c3d-0000-4000-8000-00000000000b";
const PASSPHRASE = ["lamp", "river", "kettle"].join(" ");
const STORE = "device-keys";

/** A fresh database per test. Few iterations keep the tests fast. */
function newStore(iterations = 1_000): {
  store: IndexedDbDeviceKeyStore;
  name: string;
} {
  const name = `device-test-${crypto.randomUUID()}`;
  return { store: new IndexedDbDeviceKeyStore(name, iterations), name };
}

function raw<T>(
  name: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1);
    opening.onerror = () => {
      reject(opening.error ?? new Error("open failed"));
    };
    opening.onsuccess = () => {
      const database = opening.result;
      const request = work(
        database.transaction(STORE, mode).objectStore(STORE),
      );
      request.onsuccess = () => {
        database.close();
        resolve(request.result);
      };
      request.onerror = () => {
        database.close();
        reject(request.error ?? new Error("request failed"));
      };
    };
  });
}

describe("the device key store (ADR-0004, DEV-005)", () => {
  it("follows the current OWASP iteration count and a sensible minimum length", () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(MIN_DEVICE_PASSPHRASE_LENGTH).toBe(8);
  });

  it("has nothing for a device that was never enrolled", async () => {
    const { store } = newStore();

    expect(await store.has(USER)).toBe(false);
    await expect(store.open(USER, PASSPHRASE)).rejects.toBeInstanceOf(
      DeviceStoreDamagedError,
    );
  });

  it("returns the root key for the right passphrase", async () => {
    const { store } = newStore();
    const root = generateRootKeyBytes();

    await store.enrol(USER, root, PASSPHRASE);

    expect(await store.has(USER)).toBe(true);
    expect(toBase64(await store.open(USER, PASSPHRASE))).toBe(toBase64(root));
  });

  it("works with the real iteration count", async () => {
    const { store } = newStore(PBKDF2_ITERATIONS);
    const root = generateRootKeyBytes();

    await store.enrol(USER, root, PASSPHRASE);

    expect(toBase64(await store.open(USER, PASSPHRASE))).toBe(toBase64(root));
  });

  it.each(["", "lamp river kettl", "LAMP RIVER KETTLE", " lamp river kettle"])(
    "refuses the wrong passphrase %j",
    async (wrong) => {
      const { store } = newStore();
      await store.enrol(USER, generateRootKeyBytes(), PASSPHRASE);

      await expect(store.open(USER, wrong)).rejects.toBeInstanceOf(
        DevicePassphraseError,
      );
    },
  );

  it("treats the same passphrase typed with different Unicode forms as equal", async () => {
    const { store } = newStore();
    const root = generateRootKeyBytes();
    const composed = "caf\u00e9 au lait";
    const decomposed = "cafe\u0301 au lait";

    await store.enrol(USER, root, composed);

    expect(toBase64(await store.open(USER, decomposed))).toBe(toBase64(root));
  });

  it("stores a key that script cannot read, and no readable root key", async () => {
    const { store, name } = newStore();
    const root = generateRootKeyBytes();
    await store.enrol(USER, root, PASSPHRASE);

    const record = await raw<{
      version: number;
      deviceKey: CryptoKey;
      iterations: number;
      wrapped: Uint8Array;
    }>(name, "readonly", (s) => s.get(USER));

    expect(record.version).toBe(DEVICE_FORMAT_VERSION);
    expect(record.iterations).toBe(1_000);
    expect(record.deviceKey.extractable).toBe(false);
    await expect(
      crypto.subtle.exportKey("raw", record.deviceKey),
    ).rejects.toThrow();
    expect(atob(toBase64(record.wrapped))).not.toContain(atob(toBase64(root)));
    expect(JSON.stringify(record)).not.toContain(PASSPHRASE);
  });

  it("writes nothing to localStorage or sessionStorage (SYNC-001)", async () => {
    localStorage.clear();
    sessionStorage.clear();
    const { store } = newStore();

    await store.enrol(USER, generateRootKeyBytes(), PASSPHRASE);
    await store.open(USER, PASSPHRASE);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps accounts apart on one device", async () => {
    const { store } = newStore();
    const mine = generateRootKeyBytes();
    const theirs = generateRootKeyBytes();
    await store.enrol(USER, mine, PASSPHRASE);
    await store.enrol(OTHER_USER, theirs, PASSPHRASE);

    expect(toBase64(await store.open(USER, PASSPHRASE))).toBe(toBase64(mine));
    expect(toBase64(await store.open(OTHER_USER, PASSPHRASE))).toBe(
      toBase64(theirs),
    );
  });

  it("a record moved to another account does not open there", async () => {
    const { store, name } = newStore();
    await store.enrol(USER, generateRootKeyBytes(), PASSPHRASE);
    const record = await raw<unknown>(name, "readonly", (s) => s.get(USER));
    await raw(name, "readwrite", (s) => s.put(record, OTHER_USER));

    await expect(store.open(OTHER_USER, PASSPHRASE)).rejects.toBeInstanceOf(
      DeviceStoreDamagedError,
    );
  });

  it("enrolling again replaces the passphrase", async () => {
    const { store } = newStore();
    const root = generateRootKeyBytes();
    await store.enrol(USER, root, PASSPHRASE);

    await store.enrol(USER, root, "a different passphrase");

    await expect(store.open(USER, PASSPHRASE)).rejects.toBeInstanceOf(
      DevicePassphraseError,
    );
    expect(toBase64(await store.open(USER, "a different passphrase"))).toBe(
      toBase64(root),
    );
  });

  it("forgets a device, for that account only", async () => {
    const { store } = newStore();
    await store.enrol(USER, generateRootKeyBytes(), PASSPHRASE);
    await store.enrol(OTHER_USER, generateRootKeyBytes(), PASSPHRASE);

    await store.forget(USER);
    await store.forget(USER);

    expect(await store.has(USER)).toBe(false);
    expect(await store.has(OTHER_USER)).toBe(true);
  });

  it("survives being reopened, like a page reload", async () => {
    const { store, name } = newStore();
    const root = generateRootKeyBytes();
    await store.enrol(USER, root, PASSPHRASE);

    const reopened = new IndexedDbDeviceKeyStore(name, 1_000);

    expect(toBase64(await reopened.open(USER, PASSPHRASE))).toBe(
      toBase64(root),
    );
  });

  it("opens a record made with a different iteration count", async () => {
    const { store, name } = newStore(2_000);
    const root = generateRootKeyBytes();
    await store.enrol(USER, root, PASSPHRASE);

    const later = new IndexedDbDeviceKeyStore(name, 5_000);

    expect(toBase64(await later.open(USER, PASSPHRASE))).toBe(toBase64(root));
  });

  it.each([
    ["a record from a newer format", { version: 2 }],
    ["a record missing its key", { version: 1, salt: new Uint8Array(16) }],
    ["something that is not a record", "garbage"],
    ["null", null],
  ])(
    "treats %s as damaged, not as a wrong passphrase",
    async (_name, value) => {
      const { store, name } = newStore();
      await store.enrol(USER, generateRootKeyBytes(), PASSPHRASE);
      await raw(name, "readwrite", (s) => s.put(value, USER));

      await expect(store.open(USER, PASSPHRASE)).rejects.toBeInstanceOf(
        DeviceStoreDamagedError,
      );
      expect(await store.has(USER)).toBe(false);
    },
  );

  it("treats altered ciphertext as damaged", async () => {
    const { store, name } = newStore();
    await store.enrol(USER, generateRootKeyBytes(), PASSPHRASE);
    const record = await raw<{ wrapped: Uint8Array }>(name, "readonly", (s) =>
      s.get(USER),
    );
    record.wrapped[0] = (record.wrapped[0] ?? 0) ^ 1;
    await raw(name, "readwrite", (s) => s.put(record, USER));

    await expect(store.open(USER, PASSPHRASE)).rejects.toBeInstanceOf(
      DeviceStoreDamagedError,
    );
  });

  it("refuses a passphrase that is too short, or key material of the wrong size", async () => {
    const { store } = newStore();

    await expect(
      store.enrol(USER, generateRootKeyBytes(), "short"),
    ).rejects.toThrow("too short");
    await expect(
      store.enrol(USER, new Uint8Array(16), PASSPHRASE),
    ).rejects.toThrow("32 bytes");
    expect(await store.has(USER)).toBe(false);
  });

  it("uses a fresh salt and nonces every time", async () => {
    const { store, name } = newStore();
    const root = generateRootKeyBytes();
    await store.enrol(USER, root, PASSPHRASE);
    const first = await raw<{ salt: Uint8Array; wrapped: Uint8Array }>(
      name,
      "readonly",
      (s) => s.get(USER),
    );
    await store.enrol(USER, root, PASSPHRASE);
    const second = await raw<{ salt: Uint8Array; wrapped: Uint8Array }>(
      name,
      "readonly",
      (s) => s.get(USER),
    );

    expect(toBase64(first.salt)).not.toBe(toBase64(second.salt));
    expect(toBase64(first.wrapped)).not.toBe(toBase64(second.wrapped));
  });
});
