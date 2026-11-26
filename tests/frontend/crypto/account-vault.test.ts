import { beforeEach, describe, expect, it } from "vitest";

import type {
  RecoveryEnvelopeStore,
  RecoveryEnvelopeWrite,
  StoredRecoveryEnvelope,
} from "../../../src/api/recovery-envelope-store";
import type { AuthSession } from "../../../src/auth/auth-client";
import { AccountVault } from "../../../src/crypto/account-vault";
import {
  DeviceStoreDamagedError,
  IndexedDbDeviceKeyStore,
} from "../../../src/crypto/device-key-store";
import { fromBase64, toBase64 } from "../../../src/crypto/encoding";
import { VaultError } from "../../../src/crypto/key-vault";
import { fingerprint, type RootKey } from "../../../src/crypto/root-key";
import { deviceEnrollmentKey } from "../../../src/devices/signing";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import {
  FAKE_RECOVERY_STORAGE_KEY,
  FakeRecoveryEnvelopeStore,
} from "../../../src/testing/fake-recovery-envelope-store";

const EMAIL = "sam@example.com";
const OTHER_EMAIL = "alex@example.com";
// Assembled from words so no credential-shaped literal sits in the repository.
const PHRASE = ["correct", "horse", "battery"].join(" ");
const NEW_PHRASE = ["staple", "window", "orange"].join(" ");

/** The "server": shared by every device in a test. */
let server: FakeRecoveryEnvelopeStore;
let auth: FakeAuthClient;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  server = new FakeRecoveryEnvelopeStore();
  auth = new FakeAuthClient();
});

async function signUp(email = EMAIL): Promise<void> {
  await auth.register(email, PHRASE);
  await auth.completeVerification();
}

/** A device with its own (empty) device store, talking to the same server. */
function device(envelopes: RecoveryEnvelopeStore = server): AccountVault {
  return new AccountVault(auth, envelopes);
}

async function signUpSecondAccount(): Promise<void> {
  await auth.signOut();
  await signUp(OTHER_EMAIL);
}

async function code(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(VaultError);
    return (error as VaultError).code;
  }
  throw new Error("expected a VaultError");
}

async function onboarded(): Promise<{ vault: AccountVault; key: string }> {
  await signUp();
  const vault = device();
  const key = await vault.createAccountKeys();
  await vault.confirmRecoveryKey();
  return { vault, key };
}

describe("creating account keys (AC-01, DEV-006)", () => {
  it("shows a recovery key but saves nothing until it is confirmed", async () => {
    await signUp();
    const vault = device();

    const key = await vault.createAccountKeys();

    expect(key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(await vault.accountHasKeys()).toBe(false);
    expect(await vault.fingerprint()).toBeUndefined();
    expect(localStorage.getItem(FAKE_RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it("saves only a wrapped key when the recovery key is confirmed", async () => {
    const { vault, key } = await onboarded();

    expect(await vault.accountHasKeys()).toBe(true);
    expect(await vault.fingerprint()).toMatch(/^[0-9a-f]{16}$/);
    const stored = localStorage.getItem(FAKE_RECOVERY_STORAGE_KEY) ?? "";
    expect(stored).not.toBe("");
    expect(stored).not.toContain(key);
    expect(stored).not.toContain(key.replaceAll("-", ""));
  });

  it("an abandoned attempt leaves the account without keys", async () => {
    await signUp();
    const abandoned = device();
    await abandoned.createAccountKeys();
    abandoned.lock();

    expect(await code(abandoned.confirmRecoveryKey())).toBe(
      "nothing_to_confirm",
    );
    expect(await device().accountHasKeys()).toBe(false);
  });

  it("a fresh attempt replaces an unconfirmed one", async () => {
    await signUp();
    const vault = device();
    const first = await vault.createAccountKeys();
    const second = await vault.createAccountKeys();

    await vault.confirmRecoveryKey();
    const elsewhere = device();

    expect(second).not.toBe(first);
    expect(await code(elsewhere.unlockWithRecoveryKey(first))).toBe(
      "wrong_recovery_key",
    );
    await expect(
      elsewhere.unlockWithRecoveryKey(second),
    ).resolves.toBeUndefined();
  });

  it("refuses to overwrite keys another device already created", async () => {
    const { vault: first, key } = await onboarded();
    const second = device();
    await second.createAccountKeys();

    expect(await code(second.confirmRecoveryKey())).toBe("keys_already_exist");

    expect(await second.fingerprint()).toBeUndefined();
    await second.unlockWithRecoveryKey(key);
    expect(await second.fingerprint()).toBe(await first.fingerprint());
  });

  it("keeps the unconfirmed key when saving fails, so it can be retried", async () => {
    await signUp();
    let failing = true;
    const flaky: RecoveryEnvelopeStore = {
      read: (session) => server.read(session),
      write: (session, change) =>
        failing
          ? Promise.reject(new VaultError("offline"))
          : server.write(session, change),
    };
    const vault = device(flaky);
    const key = await vault.createAccountKeys();

    expect(await code(vault.confirmRecoveryKey())).toBe("offline");
    expect(await vault.accountHasKeys()).toBe(false);

    failing = false;
    await vault.confirmRecoveryKey();
    await expect(device().unlockWithRecoveryKey(key)).resolves.toBeUndefined();
  });

  it("needs a signed-in user", async () => {
    const vault = device();

    expect(await code(vault.createAccountKeys())).toBe("signed_out");
    expect(await code(vault.accountHasKeys())).toBe("signed_out");
    expect(await code(vault.unlockWithRecoveryKey("x"))).toBe("signed_out");
    expect(await vault.hasKeysOnThisDevice()).toBe(false);
  });

  it("cannot be confirmed by a different account than prepared it", async () => {
    await signUp();
    const vault = device();
    await vault.createAccountKeys();
    await auth.signOut();
    await signUp(OTHER_EMAIL);

    expect(await code(vault.confirmRecoveryKey())).toBe("nothing_to_confirm");
  });
});

describe("recovering on a new device (DEV-001 path B)", () => {
  it("unlocks with the recovery key and holds the same root key", async () => {
    const { vault: first, key } = await onboarded();
    const second = device();

    await second.unlockWithRecoveryKey(key.toLowerCase().replaceAll("-", " "));

    expect(await second.fingerprint()).toBe(await first.fingerprint());
  });

  it("explains a typo, a malformed key and a wrong key differently", async () => {
    const { key } = await onboarded();
    const other = await device().createAccountKeys();
    const typo = (key.startsWith("Z") ? "Y" : "Z") + key.slice(1);
    const second = device();

    expect(await code(second.unlockWithRecoveryKey(typo))).toBe(
      "recovery_key_mistyped",
    );
    expect(await code(second.unlockWithRecoveryKey("not a key"))).toBe(
      "recovery_key_malformed",
    );
    expect(await code(second.unlockWithRecoveryKey(other))).toBe(
      "wrong_recovery_key",
    );
    expect(await second.fingerprint()).toBeUndefined();
  });

  it("says so when the account has no keys yet", async () => {
    await signUp();
    const key = await device().createAccountKeys();

    expect(await code(device().unlockWithRecoveryKey(key))).toBe(
      "no_account_keys",
    );
  });

  it("one account's recovery key does not open another account", async () => {
    const { key } = await onboarded();
    await auth.signOut();
    await signUp(OTHER_EMAIL);
    const theirs = device();
    const theirKey = await theirs.createAccountKeys();
    await theirs.confirmRecoveryKey();

    expect(await code(device().unlockWithRecoveryKey(key))).toBe(
      "wrong_recovery_key",
    );
    await expect(
      device().unlockWithRecoveryKey(theirKey),
    ).resolves.toBeUndefined();
  });

  it("an envelope moved to another account cannot be opened there", async () => {
    const { key } = await onboarded();
    const mine = await auth.currentSession();
    const stolen = await server.read(mine as AuthSession);
    await auth.signOut();
    await signUp(OTHER_EMAIL);
    const theirSession = (await auth.currentSession()) as AuthSession;
    await server.write(theirSession, {
      expectedVersion: 0,
      envelope: (stolen as StoredRecoveryEnvelope).envelope,
      formatVersion: 1,
      enrollmentKey: new Uint8Array(32),
    });

    expect(await code(device().unlockWithRecoveryKey(key))).toBe(
      "wrong_recovery_key",
    );
  });

  it("a new password changes nothing about the keys (AC-18)", async () => {
    const { vault: first, key } = await onboarded();
    const before = localStorage.getItem(FAKE_RECOVERY_STORAGE_KEY);
    await auth.signOut();
    await auth.requestPasswordReset(EMAIL);
    await auth.completePasswordReset(NEW_PHRASE);
    await auth.signIn(EMAIL, NEW_PHRASE);
    const second = device();

    expect(localStorage.getItem(FAKE_RECOVERY_STORAGE_KEY)).toBe(before);
    expect(await second.hasKeysOnThisDevice()).toBe(false);
    expect(await code(second.unlock(NEW_PHRASE))).toBe("no_keys_on_device");
    expect(await code(second.unlockWithRecoveryKey(NEW_PHRASE))).toBe(
      "recovery_key_malformed",
    );
    expect(await second.fingerprint()).toBeUndefined();

    await second.unlockWithRecoveryKey(key);
    expect(await second.fingerprint()).toBe(await first.fingerprint());
  });

  it("lock drops the key from memory", async () => {
    const { vault } = await onboarded();

    vault.lock();

    expect(await vault.fingerprint()).toBeUndefined();
  });
});

describe("a trusted device (DEV-005, ADR-0004)", () => {
  const PASSPHRASE = ["lamp", "river", "kettle"].join(" ");
  let databases = 0;

  /** A device with its own key store. Few iterations keep the tests fast. */
  function deviceStore(): IndexedDbDeviceKeyStore {
    databases += 1;
    return new IndexedDbDeviceKeyStore(
      `vault-test-${String(databases)}-${crypto.randomUUID()}`,
      1_000,
    );
  }

  it("is offered trust after onboarding, and is not trusted until a passphrase is set", async () => {
    await signUp();
    const vault = new AccountVault(auth, server, deviceStore());
    await vault.createAccountKeys();
    expect(vault.deviceTrustPending()).toBe(false);

    await vault.confirmRecoveryKey();

    expect(vault.deviceTrustPending()).toBe(true);
    expect(await vault.hasKeysOnThisDevice()).toBe(false);
  });

  it("unlocks again with the device passphrase, across a reload", async () => {
    await signUp();
    const store = deviceStore();
    const vault = new AccountVault(auth, server, store);
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    const fingerprint = await vault.fingerprint();

    await vault.trustThisDevice(PASSPHRASE);
    expect(vault.deviceTrustPending()).toBe(false);
    vault.lock();
    expect(await vault.hasKeysOnThisDevice()).toBe(true);

    const reloaded = new AccountVault(auth, server, store);
    await reloaded.unlock(PASSPHRASE);

    expect(await reloaded.fingerprint()).toBe(fingerprint);
    // Unlocking with the passphrase does not ask about trust again.
    expect(reloaded.deviceTrustPending()).toBe(false);
  });

  it("stays locked for a wrong passphrase, and the right one still works", async () => {
    await signUp();
    const vault = new AccountVault(auth, server, deviceStore());
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    await vault.trustThisDevice(PASSPHRASE);
    vault.lock();

    expect(await code(vault.unlock("not the passphrase"))).toBe(
      "wrong_device_passphrase",
    );
    expect(await code(vault.unlock(PHRASE))).toBe("wrong_device_passphrase");
    expect(await vault.fingerprint()).toBeUndefined();

    await expect(vault.unlock(PASSPHRASE)).resolves.toBeUndefined();
  });

  it("the account password is not the device passphrase (DEV-006)", async () => {
    await signUp();
    const vault = new AccountVault(auth, server, deviceStore());
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    await vault.trustThisDevice(PASSPHRASE);
    vault.lock();

    expect(await code(vault.unlock(PHRASE))).toBe("wrong_device_passphrase");
  });

  it("is offered trust again after a recovery, and only for that account", async () => {
    const { key } = await onboarded();
    const store = deviceStore();
    const vault = new AccountVault(auth, server, store);
    await vault.unlockWithRecoveryKey(key);
    expect(vault.deviceTrustPending()).toBe(true);
    await vault.trustThisDevice(PASSPHRASE);
    vault.lock();
    await expect(vault.unlock(PASSPHRASE)).resolves.toBeUndefined();

    await auth.signOut();
    await signUp(OTHER_EMAIL);

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(await code(vault.unlock(PASSPHRASE))).toBe("no_keys_on_device");
  });

  it("declining leaves the device needing the recovery key", async () => {
    const { key } = await onboarded();
    const vault = new AccountVault(auth, server, deviceStore());
    await vault.unlockWithRecoveryKey(key);

    vault.skipDeviceTrust();

    expect(vault.deviceTrustPending()).toBe(false);
    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(await code(vault.trustThisDevice(PASSPHRASE))).toBe(
      "nothing_to_trust",
    );
  });

  it("locking withdraws a pending offer", async () => {
    const { key } = await onboarded();
    const vault = new AccountVault(auth, server, deviceStore());
    await vault.unlockWithRecoveryKey(key);

    vault.lock();

    expect(vault.deviceTrustPending()).toBe(false);
    expect(await code(vault.trustThisDevice(PASSPHRASE))).toBe(
      "nothing_to_trust",
    );
  });

  it("an offer made to one account cannot be taken up by another", async () => {
    const { key } = await onboarded();
    const vault = new AccountVault(auth, server, deviceStore());
    await vault.unlockWithRecoveryKey(key);
    await auth.signOut();
    await signUp(OTHER_EMAIL);

    expect(await code(vault.trustThisDevice(PASSPHRASE))).toBe(
      "nothing_to_trust",
    );
  });

  it("can be retried when saving the device key fails", async () => {
    const { key } = await onboarded();
    const store = deviceStore();
    const enrol = store.enrol.bind(store);
    let failing = true;
    store.enrol = (...args) =>
      failing ? Promise.reject(new Error("storage full")) : enrol(...args);
    const vault = new AccountVault(auth, server, store);
    await vault.unlockWithRecoveryKey(key);

    await expect(vault.trustThisDevice(PASSPHRASE)).rejects.toThrow(
      "storage full",
    );
    expect(vault.deviceTrustPending()).toBe(true);

    failing = false;
    await vault.trustThisDevice(PASSPHRASE);
    vault.lock();
    await expect(vault.unlock(PASSPHRASE)).resolves.toBeUndefined();
  });

  it("removes a damaged device record and points to the recovery key", async () => {
    const { key } = await onboarded();
    const store = deviceStore();
    const vault = new AccountVault(auth, server, store);
    await vault.unlockWithRecoveryKey(key);
    await vault.trustThisDevice(PASSPHRASE);
    vault.lock();
    store.open = () => Promise.reject(new DeviceStoreDamagedError());

    expect(await code(vault.unlock(PASSPHRASE))).toBe("device_store_damaged");

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    await expect(vault.unlockWithRecoveryKey(key)).resolves.toBeUndefined();
  });

  it("stops trusting the device after too many wrong passphrases; the recovery key still works", async () => {
    const { key } = await onboarded();
    const vault = new AccountVault(auth, server, deviceStore());
    await vault.unlockWithRecoveryKey(key);
    await vault.trustThisDevice(PASSPHRASE);
    vault.lock();

    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(await code(vault.unlock("a wrong passphrase"))).toBe(
        "wrong_device_passphrase",
      );
    }
    expect(await code(vault.unlock("a wrong passphrase"))).toBe(
      "device_locked_out",
    );

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(await code(vault.unlock(PASSPHRASE))).toBe("no_keys_on_device");
    await vault.unlockWithRecoveryKey(key);
    expect(vault.deviceTrustPending()).toBe(true);
  });

  it("does not hide an unexpected storage failure", async () => {
    const { key } = await onboarded();
    const store = deviceStore();
    const vault = new AccountVault(auth, server, store);
    await vault.unlockWithRecoveryKey(key);
    await vault.trustThisDevice(PASSPHRASE);
    vault.lock();
    store.open = () => Promise.reject(new Error("quota"));

    await expect(vault.unlock(PASSPHRASE)).rejects.toThrow("quota");
  });

  it("replacing the recovery key does not ask about this device again", async () => {
    const { vault, key } = await onboarded();
    const trusted = new AccountVault(auth, server, deviceStore());
    await trusted.unlockWithRecoveryKey(key);
    trusted.skipDeviceTrust();

    await trusted.beginRecoveryKeyRotation(key);
    await trusted.confirmRecoveryKeyRotation();

    expect(trusted.deviceTrustPending()).toBe(false);
    expect(await trusted.fingerprint()).toBe(await vault.fingerprint());
  });

  it("without a device store, always needs the recovery key and offers no trust", async () => {
    const { vault } = await onboarded();
    expect(vault.deviceTrustPending()).toBe(false);
    vault.lock();

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(await code(vault.unlock(PASSPHRASE))).toBe("no_keys_on_device");
    expect(await code(vault.trustThisDevice(PASSPHRASE))).toBe(
      "nothing_to_trust",
    );
  });
});

describe("replacing the recovery key (SEC-003)", () => {
  it("keeps the same root key; the old key stops working and the new one works", async () => {
    const { vault, key } = await onboarded();
    const fingerprint = await vault.fingerprint();

    const newKey = await vault.beginRecoveryKeyRotation(key);
    await vault.confirmRecoveryKeyRotation();

    expect(newKey).not.toBe(key);
    expect(await vault.fingerprint()).toBe(fingerprint);
    const elsewhere = device();
    expect(await code(elsewhere.unlockWithRecoveryKey(key))).toBe(
      "wrong_recovery_key",
    );
    await elsewhere.unlockWithRecoveryKey(newKey);
    expect(await elsewhere.fingerprint()).toBe(fingerprint);
  });

  it("an interrupted rotation leaves the old key valid", async () => {
    const { vault, key } = await onboarded();
    const before = localStorage.getItem(FAKE_RECOVERY_STORAGE_KEY);

    const abandoned = await vault.beginRecoveryKeyRotation(key);
    vault.lock();

    expect(localStorage.getItem(FAKE_RECOVERY_STORAGE_KEY)).toBe(before);
    expect(await code(vault.confirmRecoveryKeyRotation())).toBe(
      "nothing_to_confirm",
    );
    await expect(device().unlockWithRecoveryKey(key)).resolves.toBeUndefined();
    expect(await code(device().unlockWithRecoveryKey(abandoned))).toBe(
      "wrong_recovery_key",
    );
  });

  it("a rotation whose save fails leaves the old key valid and can be retried", async () => {
    const { key } = await onboarded();
    let failing = true;
    const flaky: RecoveryEnvelopeStore = {
      read: (session) => server.read(session),
      write: (session, change) =>
        failing
          ? Promise.reject(new VaultError("offline"))
          : server.write(session, change),
    };
    const vault = device(flaky);
    const newKey = await vault.beginRecoveryKeyRotation(key);

    expect(await code(vault.confirmRecoveryKeyRotation())).toBe("offline");
    await expect(device().unlockWithRecoveryKey(key)).resolves.toBeUndefined();

    failing = false;
    await vault.confirmRecoveryKeyRotation();
    await expect(
      device().unlockWithRecoveryKey(newKey),
    ).resolves.toBeUndefined();
  });

  it("needs the current recovery key", async () => {
    const { vault, key } = await onboarded();
    const wrong = await device().createAccountKeys();

    expect(await code(vault.beginRecoveryKeyRotation(wrong))).toBe(
      "wrong_recovery_key",
    );
    expect(await code(vault.beginRecoveryKeyRotation("nope"))).toBe(
      "recovery_key_malformed",
    );
    expect(await code(vault.confirmRecoveryKeyRotation())).toBe(
      "nothing_to_confirm",
    );
    await expect(device().unlockWithRecoveryKey(key)).resolves.toBeUndefined();
  });

  it("only one of two devices rotating at once wins, and says so on the other", async () => {
    const { vault: first, key } = await onboarded();
    const second = device();
    const firstNew = await first.beginRecoveryKeyRotation(key);
    const secondNew = await second.beginRecoveryKeyRotation(key);

    await first.confirmRecoveryKeyRotation();

    expect(await code(second.confirmRecoveryKeyRotation())).toBe(
      "recovery_key_changed_elsewhere",
    );
    await expect(
      device().unlockWithRecoveryKey(firstNew),
    ).resolves.toBeUndefined();
    expect(await code(device().unlockWithRecoveryKey(secondNew))).toBe(
      "wrong_recovery_key",
    );
  });

  it("a creation step cannot be used to confirm a rotation, or the reverse", async () => {
    const { vault, key } = await onboarded();
    await vault.beginRecoveryKeyRotation(key);

    expect(await code(vault.confirmRecoveryKey())).toBe("nothing_to_confirm");

    await signUpSecondAccount();
    const fresh = device();
    await fresh.createAccountKeys();
    expect(await code(fresh.confirmRecoveryKeyRotation())).toBe(
      "nothing_to_confirm",
    );
    expect(await fresh.accountHasKeys()).toBe(false);
  });

  it("a wrong current key abandons anything prepared earlier", async () => {
    const { vault, key } = await onboarded();
    await vault.beginRecoveryKeyRotation(key);

    expect(await code(vault.beginRecoveryKeyRotation("nope"))).toBe(
      "recovery_key_malformed",
    );

    expect(await code(vault.confirmRecoveryKeyRotation())).toBe(
      "nothing_to_confirm",
    );
  });

  it("never stores the same wrapped value twice", async () => {
    const { vault, key } = await onboarded();
    const session = (await auth.currentSession()) as AuthSession;
    const before = await server.read(session);

    await vault.beginRecoveryKeyRotation(key);
    await vault.confirmRecoveryKeyRotation();
    const after = await server.read(session);

    expect(after?.version).toBe(2);
    expect(toBase64(after?.envelope ?? new Uint8Array())).not.toBe(
      toBase64(before?.envelope ?? new Uint8Array()),
    );
  });
});

describe("what the vault gives device registration (DEV-002, ADR-0005)", () => {
  const PASSPHRASE = ["lamp", "river", "kettle"].join(" ");

  /** A server that records what was written to it. */
  function recording(): {
    store: RecoveryEnvelopeStore;
    writes: RecoveryEnvelopeWrite[];
  } {
    const writes: RecoveryEnvelopeWrite[] = [];
    return {
      writes,
      store: {
        read: (session) => server.read(session),
        write: (session, change) => {
          writes.push(change);
          return server.write(session, change);
        },
      },
    };
  }

  it("sends the enrollment verifier derived from the new root key with the first envelope", async () => {
    await signUp();
    const { store, writes } = recording();
    const vault = new AccountVault(auth, store);
    await vault.createAccountKeys();

    await vault.confirmRecoveryKey();

    const root = vault.rootKey() as RootKey;
    expect(writes).toHaveLength(1);
    expect(writes[0]?.expectedVersion).toBe(0);
    expect(toBase64(writes[0]?.enrollmentKey ?? new Uint8Array())).toBe(
      toBase64(await deviceEnrollmentKey(root)),
    );
  });

  it("the verifier is not the root key, the envelope or the fingerprint", async () => {
    await signUp();
    const { store, writes } = recording();
    const vault = new AccountVault(auth, store);
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();

    const verifier = toBase64(writes[0]?.enrollmentKey ?? new Uint8Array());

    expect(writes[0]?.enrollmentKey).toHaveLength(32);
    expect(toBase64(writes[0]?.envelope ?? new Uint8Array())).not.toContain(
      verifier.slice(0, 16),
    );
    expect(await vault.fingerprint()).not.toBe(verifier);
  });

  it("exposes the root key only while unlocked", async () => {
    await signUp();
    const vault = device();
    expect(vault.rootKey()).toBeUndefined();

    await vault.createAccountKeys();
    expect(vault.rootKey()).toBeUndefined();
    await vault.confirmRecoveryKey();

    const root = vault.rootKey();
    expect(root).toBeDefined();
    expect(await fingerprint(root as RootKey)).toBe(await vault.fingerprint());

    vault.lock();
    expect(vault.rootKey()).toBeUndefined();
  });

  it("tells the registration hook about every unlock, with the root key", async () => {
    await signUp();
    const seen: string[] = [];
    const record = (root: RootKey): void => {
      void fingerprint(root).then((value) => seen.push(value));
    };
    const store = new IndexedDbDeviceKeyStore(
      `vault-hook-${crypto.randomUUID()}`,
      1_000,
    );
    const vault = new AccountVault(auth, server, store, record);

    const key = await vault.createAccountKeys();
    expect(seen).toHaveLength(0);
    await vault.confirmRecoveryKey();
    await vault.trustThisDevice(PASSPHRASE);
    const expected = await vault.fingerprint();
    vault.lock();
    await vault.unlock(PASSPHRASE);
    vault.lock();
    await vault.unlockWithRecoveryKey(key);

    await expect.poll(() => seen).toEqual([expected, expected, expected]);
  });

  it("does not tell the hook about a failed unlock or a rotation that was not saved", async () => {
    const { key } = await onboarded();
    let unlocks = 0;
    const vault = new AccountVault(auth, server, undefined, () => {
      unlocks += 1;
    });

    expect(await code(vault.unlockWithRecoveryKey("nope"))).toBe(
      "recovery_key_malformed",
    );
    await vault.beginRecoveryKeyRotation(key);

    expect(unlocks).toBe(0);
  });
});

describe("releasing and accepting the root key for pairing (DEV-001 path A)", () => {
  const PASSPHRASE = ["lamp", "river", "kettle"].join(" ");

  async function trusted(): Promise<{ vault: AccountVault; key: string }> {
    await signUp();
    const vault = new AccountVault(
      auth,
      server,
      new IndexedDbDeviceKeyStore(`vault-pair-${crypto.randomUUID()}`, 1_000),
    );
    const key = await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    await vault.trustThisDevice(PASSPHRASE);
    return { vault, key };
  }

  it("releases the unlocked root key for the passphrase or the recovery key, then wipes it", async () => {
    const { vault, key } = await trusted();
    const seen: Uint8Array[] = [];
    const copies: string[] = [];

    for (const credential of [
      { kind: "device_passphrase", passphrase: PASSPHRASE } as const,
      { kind: "recovery_key", recoveryKey: key } as const,
    ]) {
      const length = await vault.withRootKeyBytes(credential, (bytes) => {
        seen.push(bytes);
        copies.push(toBase64(bytes));
        return Promise.resolve(bytes.length);
      });
      expect(length).toBe(32);
    }

    expect(copies[0]).toBe(copies[1]);
    expect(seen.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    const other = device();
    await other.acceptRootKey(fromBase64(copies[0] ?? ""));
    expect(await other.fingerprint()).toBe(await vault.fingerprint());
  });

  it("wipes the key even when its use fails", async () => {
    const { vault } = await trusted();
    let seen: Uint8Array = new Uint8Array(1).fill(1);

    await expect(
      vault.withRootKeyBytes(
        { kind: "device_passphrase", passphrase: PASSPHRASE },
        (bytes) => {
          seen = bytes;
          return Promise.reject(new Error("could not send"));
        },
      ),
    ).rejects.toThrow("could not send");

    expect(seen.every((byte) => byte === 0)).toBe(true);
  });

  it.each([
    [
      { kind: "device_passphrase", passphrase: "not the passphrase" } as const,
      "wrong_device_passphrase",
    ],
    [
      { kind: "recovery_key", recoveryKey: "nope" } as const,
      "recovery_key_malformed",
    ],
  ])(
    "releases nothing for a wrong credential",
    async (credential, expected) => {
      const { vault } = await trusted();
      let used = false;

      expect(
        await code(
          vault.withRootKeyBytes(credential, () => {
            used = true;
            return Promise.resolve();
          }),
        ),
      ).toBe(expected);
      expect(used).toBe(false);
    },
  );

  it("releases nothing while locked, or on a device with no stored key", async () => {
    const { vault, key } = await trusted();
    const untrusted = device();
    await untrusted.unlockWithRecoveryKey(key);
    const use = (): Promise<void> => Promise.reject(new Error("must not run"));

    expect(
      await code(
        untrusted.withRootKeyBytes(
          { kind: "device_passphrase", passphrase: PASSPHRASE },
          use,
        ),
      ),
    ).toBe("no_keys_on_device");
    vault.lock();
    expect(
      await code(
        vault.withRootKeyBytes(
          { kind: "device_passphrase", passphrase: PASSPHRASE },
          use,
        ),
      ),
    ).toBe("locked");
  });

  it("never releases a key other than the one this device is unlocked with", async () => {
    await signUp();
    const first = device();
    const firstKey = await first.createAccountKeys();
    await first.confirmRecoveryKey();
    // A second envelope for the same account, wrapping a different root key
    // under a different recovery key, as a hostile server could present.
    const elsewhere = new FakeRecoveryEnvelopeStore(sessionStorage);
    const second = device(elsewhere);
    const secondKey = await second.createAccountKeys();
    await second.confirmRecoveryKey();
    let swapped = false;
    const switching: RecoveryEnvelopeStore = {
      read: (session) => (swapped ? elsewhere : server).read(session),
      write: (session, change) => server.write(session, change),
    };
    const vault = device(switching);
    await vault.unlockWithRecoveryKey(firstKey);
    let used = false;

    swapped = true;
    const refused = await code(
      vault.withRootKeyBytes(
        { kind: "recovery_key", recoveryKey: secondKey },
        () => {
          used = true;
          return Promise.resolve();
        },
      ),
    );

    expect(refused).toBe("locked");
    expect(used).toBe(false);
    expect(await second.fingerprint()).not.toBe(await vault.fingerprint());
  });

  it("accepting a key unlocks, offers device trust and tells the registration hook", async () => {
    const { vault, key } = await trusted();
    let hooked = 0;
    const fresh = new AccountVault(
      auth,
      server,
      new IndexedDbDeviceKeyStore(`vault-pair-${crypto.randomUUID()}`, 1_000),
      () => {
        hooked += 1;
      },
    );
    const copy = await vault.withRootKeyBytes(
      { kind: "recovery_key", recoveryKey: key },
      (bytes) => Promise.resolve(bytes.slice()),
    );

    await fresh.acceptRootKey(copy);

    expect(await fresh.fingerprint()).toBe(await vault.fingerprint());
    expect(fresh.deviceTrustPending()).toBe(true);
    expect(hooked).toBe(1);
  });

  it("accepting a key needs a signed-in user and exactly 32 bytes", async () => {
    await signUp();
    await expect(device().acceptRootKey(new Uint8Array(31))).rejects.toThrow();
    await auth.signOut();

    expect(await code(device().acceptRootKey(new Uint8Array(32)))).toBe(
      "signed_out",
    );
  });
});
