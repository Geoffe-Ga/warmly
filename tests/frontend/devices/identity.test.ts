import { beforeEach, describe, expect, it } from "vitest";

import { fromBase64, utf8 } from "../../../src/crypto/encoding";
import { IndexedDbDeviceIdentityStore } from "../../../src/devices/identity";

const USER = "0a1b2c3d-0000-4000-8000-00000000000a";
const OTHER_USER = "0a1b2c3d-0000-4000-8000-00000000000b";
let databases = 0;
let name: string;

beforeEach(() => {
  databases += 1;
  name = `warmly-identity-test-${String(databases)}`;
});

function put(value: unknown, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore("identities");
    };
    opening.onerror = () => {
      reject(new Error("open failed"));
    };
    opening.onsuccess = () => {
      const transaction = opening.result.transaction("identities", "readwrite");
      transaction.objectStore("identities").put(value, key);
      transaction.oncomplete = () => {
        opening.result.close();
        resolve();
      };
    };
  });
}

describe("this device's identity (DEV-002, D-06)", () => {
  it("has none until one is created", async () => {
    expect(
      await new IndexedDbDeviceIdentityStore(name).get(USER),
    ).toBeUndefined();
  });

  it("creates a random device ID and a P-256 public key, not yet registered", async () => {
    const identity = await new IndexedDbDeviceIdentityStore(name).getOrCreate(
      USER,
    );

    expect(identity.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const point = fromBase64(identity.publicKey);
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(4);
    expect(identity.registered).toBe(false);
  });

  it("keeps the same identity across instances, like a reload", async () => {
    const first = await new IndexedDbDeviceIdentityStore(name).getOrCreate(
      USER,
    );

    const again = await new IndexedDbDeviceIdentityStore(name).getOrCreate(
      USER,
    );
    const read = await new IndexedDbDeviceIdentityStore(name).get(USER);

    expect(again.deviceId).toBe(first.deviceId);
    expect(again.publicKey).toBe(first.publicKey);
    expect(read?.deviceId).toBe(first.deviceId);
  });

  it("signs with the key whose public half it reports: 64 raw bytes that verify", async () => {
    const identity = await new IndexedDbDeviceIdentityStore(name).getOrCreate(
      USER,
    );
    const message = utf8("a message");

    const signature = fromBase64(await identity.sign(message));

    expect(signature).toHaveLength(64);
    const key = await crypto.subtle.importKey(
      "raw",
      fromBase64(identity.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        message,
      ),
    ).toBe(true);
  });

  it("gives each account its own identity, so accounts are not linkable by key", async () => {
    const store = new IndexedDbDeviceIdentityStore(name);

    const mine = await store.getOrCreate(USER);
    const theirs = await store.getOrCreate(OTHER_USER);

    expect(theirs.deviceId).not.toBe(mine.deviceId);
    expect(theirs.publicKey).not.toBe(mine.publicKey);
  });

  it("gives two tabs starting at once the same identity", async () => {
    const [first, second] = await Promise.all([
      new IndexedDbDeviceIdentityStore(name).getOrCreate(USER),
      new IndexedDbDeviceIdentityStore(name).getOrCreate(USER),
    ]);

    expect(second.deviceId).toBe(first.deviceId);
    expect(second.publicKey).toBe(first.publicKey);
  });

  it("remembers that the server accepted it", async () => {
    const store = new IndexedDbDeviceIdentityStore(name);
    const created = await store.getOrCreate(USER);

    await store.markRegistered(USER);

    const stored = await store.get(USER);
    expect(stored?.registered).toBe(true);
    expect(stored?.deviceId).toBe(created.deviceId);
  });

  it("does nothing when asked to mark an identity that does not exist", async () => {
    const store = new IndexedDbDeviceIdentityStore(name);

    await store.markRegistered(USER);

    expect(await store.get(USER)).toBeUndefined();
  });

  it("forgets one account's identity for good; the next one is a new device", async () => {
    const store = new IndexedDbDeviceIdentityStore(name);
    const mine = await store.getOrCreate(USER);
    const theirs = await store.getOrCreate(OTHER_USER);

    await store.forget(USER);
    await store.forget("nobody");

    expect(await store.get(USER)).toBeUndefined();
    expect((await store.get(OTHER_USER))?.deviceId).toBe(theirs.deviceId);
    const fresh = await store.getOrCreate(USER);
    expect(fresh.deviceId).not.toBe(mine.deviceId);
    expect(fresh.publicKey).not.toBe(mine.publicKey);
    expect(fresh.registered).toBe(false);
  });

  it("keeps the private key where script cannot read it", async () => {
    const store = new IndexedDbDeviceIdentityStore(name);
    await store.getOrCreate(USER);

    const stored = await new Promise<Record<string, unknown>>((resolve) => {
      const opening = indexedDB.open(name, 1);
      opening.onsuccess = () => {
        const reading = opening.result
          .transaction("identities")
          .objectStore("identities")
          .get(USER);
        reading.onsuccess = () => {
          opening.result.close();
          resolve(reading.result as Record<string, unknown>);
        };
      };
    });

    const key = stored["privateKey"] as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(key.usages).toEqual(["sign"]);
    await expect(crypto.subtle.exportKey("pkcs8", key)).rejects.toThrow();
  });

  it.each([
    ["not an object", "junk"],
    ["missing fields", { deviceId: "x" }],
    [
      "a key that is not a key",
      { deviceId: "x", publicKey: "y", registered: true, privateKey: {} },
    ],
    [
      "an extractable key",
      {
        deviceId: "x",
        publicKey: "y",
        registered: true,
        privateKey: { type: "private", extractable: true },
      },
    ],
    [
      "a public key in the private slot",
      {
        deviceId: "x",
        publicKey: "y",
        registered: true,
        privateKey: { type: "public", extractable: false },
      },
    ],
    [
      "a null key",
      { deviceId: "x", publicKey: "y", registered: true, privateKey: null },
    ],
    [
      "a flag that is not a boolean",
      { deviceId: "x", publicKey: "y", registered: "yes", privateKey: {} },
    ],
    ["a public key that is not text", { deviceId: "x", publicKey: 1 }],
  ])(
    "replaces a stored record that is %s with a new identity",
    async (_name, value) => {
      await put(value, USER);
      const store = new IndexedDbDeviceIdentityStore(name);

      expect(await store.get(USER)).toBeUndefined();
      const fresh = await store.getOrCreate(USER);

      expect(fresh.registered).toBe(false);
      expect((await store.get(USER))?.deviceId).toBe(fresh.deviceId);
    },
  );

  it("uses one database for the whole browser by default", async () => {
    const identity = await new IndexedDbDeviceIdentityStore().getOrCreate(USER);

    expect(
      (await new IndexedDbDeviceIdentityStore("warmly-identity").get(USER))
        ?.deviceId,
    ).toBe(identity.deviceId);
  });
});
