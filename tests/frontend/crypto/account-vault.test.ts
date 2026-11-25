import { beforeEach, describe, expect, it } from "vitest";

import type {
  RecoveryEnvelopeStore,
  StoredRecoveryEnvelope,
} from "../../../src/api/recovery-envelope-store";
import type { AuthSession } from "../../../src/auth/auth-client";
import { AccountVault } from "../../../src/crypto/account-vault";
import { toBase64 } from "../../../src/crypto/encoding";
import { VaultError } from "../../../src/crypto/key-vault";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import { FakeDeviceKeyStore } from "../../../src/testing/fake-device-key-store";
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
      write: (session, expected, envelope, format) =>
        failing
          ? Promise.reject(new VaultError("offline"))
          : server.write(session, expected, envelope, format),
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
    await server.write(
      theirSession,
      0,
      (stolen as StoredRecoveryEnvelope).envelope,
      1,
    );

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
    expect(await code(second.unlock())).toBe("no_keys_on_device");
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

describe("a trusted device", () => {
  it("can unlock again without the recovery key once it has a device store", async () => {
    await signUp();
    const store = new FakeDeviceKeyStore();
    const vault = new AccountVault(auth, server, store);
    await vault.createAccountKeys();
    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    await vault.confirmRecoveryKey();
    const fingerprint = await vault.fingerprint();
    vault.lock();

    expect(await vault.hasKeysOnThisDevice()).toBe(true);
    const reloaded = new AccountVault(auth, server, store);
    await reloaded.unlock();

    expect(await reloaded.fingerprint()).toBe(fingerprint);
  });

  it("remembers the key after a recovery, and only for that account", async () => {
    const { key } = await onboarded();
    const store = new FakeDeviceKeyStore();
    const vault = new AccountVault(auth, server, store);
    await vault.unlockWithRecoveryKey(key);
    vault.lock();
    await expect(vault.unlock()).resolves.toBeUndefined();

    await auth.signOut();
    await signUp(OTHER_EMAIL);

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(await code(vault.unlock())).toBe("no_keys_on_device");
  });

  it("still finishes setting up when the device cannot remember the key", async () => {
    await signUp();
    const store = new FakeDeviceKeyStore();
    store.save = () => Promise.reject(new Error("storage full"));
    const vault = new AccountVault(auth, server, store);
    const key = await vault.createAccountKeys();

    await expect(vault.confirmRecoveryKey()).resolves.toBeUndefined();

    expect(await vault.fingerprint()).toMatch(/^[0-9a-f]{16}$/);
    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    // The change is not pending any more, and is not reported as a conflict.
    expect(await code(vault.confirmRecoveryKey())).toBe("nothing_to_confirm");
    await expect(device().unlockWithRecoveryKey(key)).resolves.toBeUndefined();
  });

  it("without a device store, always needs the recovery key", async () => {
    const { vault } = await onboarded();
    vault.lock();

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(await code(vault.unlock())).toBe("no_keys_on_device");
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
      write: (session, expected, envelope, format) =>
        failing
          ? Promise.reject(new VaultError("offline"))
          : server.write(session, expected, envelope, format),
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
