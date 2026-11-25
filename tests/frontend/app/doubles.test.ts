import { beforeEach, describe, expect, it } from "vitest";

import {
  createAuthClient,
  createKeyVault,
  createServices,
} from "../../../src/app/services";
import {
  AuthError,
  UnavailableAuthClient,
} from "../../../src/auth/auth-client";
import { SupabaseAuthClient } from "../../../src/auth/supabase-auth-client";
import { AccountVault } from "../../../src/crypto/account-vault";
import { IndexedDbDeviceKeyStore } from "../../../src/crypto/device-key-store";
import { UnavailableKeyVault, VaultError } from "../../../src/crypto/key-vault";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import { FakeRecoveryEnvelopeStore } from "../../../src/testing/fake-recovery-envelope-store";
import {
  FAKE_DEVICE_PASSPHRASE,
  FAKE_RECOVERY_KEY,
  FAKE_ROTATED_RECOVERY_KEY,
  FakeKeyVault,
  normaliseRecoveryKey,
} from "../../../src/testing/fake-key-vault";
import { describeError } from "../../../src/ui/screens/account/shared";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("FakeAuthClient", () => {
  it("keeps a signed-in session across instances, like a page reload", async () => {
    const first = new FakeAuthClient();
    await first.register("a@example.com", "a long password");
    await first.completeVerification();

    expect(await new FakeAuthClient().isSignedIn()).toBe(true);
  });

  it("does not overwrite an existing account on a second registration", async () => {
    const auth = new FakeAuthClient();
    await auth.register("a@example.com", "the first password");
    await auth.completeVerification();
    await auth.signOut();

    await auth.register("a@example.com", "an attacker password");
    // Registering someone else's address must not let you verify into it.
    await expect(auth.completeVerification()).resolves.toBe(false);
    await expect(auth.isSignedIn()).resolves.toBe(false);

    await expect(
      auth.signIn("a@example.com", "an attacker password"),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      auth.signIn("a@example.com", "the first password"),
    ).resolves.toBeUndefined();
  });

  it.each(["__proto__", "constructor", "toString"])(
    "treats the address %j as an ordinary account name",
    async (email) => {
      const auth = new FakeAuthClient();

      await expect(auth.signIn(email, "anything")).rejects.toMatchObject({
        code: "invalid_credentials",
      });
      await auth.register(email, "a long password");
      await auth.completeVerification();
      await auth.signOut();
      await expect(
        auth.signIn(email, "a long password"),
      ).resolves.toBeUndefined();
    },
  );

  it("reports nothing to verify when no registration is pending", async () => {
    expect(await new FakeAuthClient().completeVerification()).toBe(false);
  });

  it("accepts a reset request for any address", async () => {
    await expect(
      new FakeAuthClient().requestPasswordReset("anyone@example.com"),
    ).resolves.toBeUndefined();
  });

  it("changes the password through a reset, once, and signs the user out", async () => {
    const auth = new FakeAuthClient();
    await auth.register("a@example.com", "the first password");
    await auth.completeVerification();

    await auth.requestPasswordReset("a@example.com");
    await auth.completePasswordReset("the second password");

    await expect(auth.isSignedIn()).resolves.toBe(false);
    await expect(
      auth.signIn("a@example.com", "the first password"),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      auth.signIn("a@example.com", "the second password"),
    ).resolves.toBeUndefined();
    await expect(
      auth.completePasswordReset("a third password"),
    ).rejects.toMatchObject({ code: "reset_link_invalid" });
  });

  it("refuses to set a password without a reset link", async () => {
    const auth = new FakeAuthClient();
    await auth.register("a@example.com", "the first password");

    await expect(
      auth.completePasswordReset("an attacker password"),
    ).rejects.toMatchObject({ code: "reset_link_invalid" });
  });

  it("does not create an account through a reset for an unknown address", async () => {
    const auth = new FakeAuthClient();

    await auth.requestPasswordReset("nobody@example.com");

    await expect(
      auth.completePasswordReset("a new password"),
    ).rejects.toMatchObject({ code: "reset_link_invalid" });
    await expect(
      auth.signIn("nobody@example.com", "a new password"),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("gives each account a stable, synthetic ID while signed in", async () => {
    const auth = new FakeAuthClient();
    expect(await auth.currentSession()).toBeUndefined();

    await auth.register("a@example.com", "a long password");
    await auth.completeVerification();
    const first = await auth.currentSession();
    await auth.signOut();
    await auth.register("b@example.com", "a long password");
    await auth.completeVerification();
    const second = await auth.currentSession();

    expect(first?.userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(second?.userId).toBe("00000000-0000-4000-8000-000000000002");
    expect(await new FakeAuthClient().currentSession()).toEqual(second);
  });

  it("a second tab is a second device: same accounts, its own session", async () => {
    const first = new FakeAuthClient();
    await first.register("a@example.com", "a long password");
    await first.completeVerification();
    const otherTab: Storage = window.localStorage;
    sessionStorage.clear();
    const second = new FakeAuthClient(sessionStorage, otherTab);

    expect(await second.isSignedIn()).toBe(false);
    await expect(
      second.signIn("a@example.com", "a long password"),
    ).resolves.toBeUndefined();
  });

  it("uses the storages it is given", async () => {
    const session = window.localStorage;
    const server = window.sessionStorage;
    const auth = new FakeAuthClient(session, server);

    await auth.register("a@example.com", "a long password");

    expect(session.getItem("warmly.fake.auth")).toContain("a@example.com");
    expect(server.getItem("warmly.fake.server.accounts")).toContain(
      "a@example.com",
    );
  });
});

describe("FakeKeyVault", () => {
  it("has no keys until an account is created", async () => {
    const vault = new FakeKeyVault();

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(await vault.accountHasKeys()).toBe(false);
    expect(await vault.fingerprint()).toBeUndefined();
    expect(vault.deviceTrustPending()).toBe(false);
    await expect(vault.unlock(FAKE_DEVICE_PASSPHRASE)).rejects.toMatchObject({
      code: "no_keys_on_device",
    });
    await expect(
      vault.trustThisDevice(FAKE_DEVICE_PASSPHRASE),
    ).rejects.toMatchObject({ code: "nothing_to_trust" });
    await expect(
      vault.unlockWithRecoveryKey(FAKE_RECOVERY_KEY),
    ).rejects.toMatchObject({ code: "no_account_keys" });
    await expect(
      vault.beginRecoveryKeyRotation(FAKE_RECOVERY_KEY),
    ).rejects.toMatchObject({ code: "no_account_keys" });
  });

  it("saves nothing until the recovery key is confirmed", async () => {
    const vault = new FakeKeyVault();

    expect(await vault.createAccountKeys()).toBe(FAKE_RECOVERY_KEY);
    expect(vault.isUnlocked).toBe(false);
    expect(await vault.accountHasKeys()).toBe(false);

    await vault.confirmRecoveryKey();

    expect(vault.isUnlocked).toBe(true);
    expect(await vault.accountHasKeys()).toBe(true);
    expect(await vault.fingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("has nothing to confirm before keys are prepared, or after a lock", async () => {
    const vault = new FakeKeyVault();
    await expect(vault.confirmRecoveryKey()).rejects.toMatchObject({
      code: "nothing_to_confirm",
    });

    await vault.createAccountKeys();
    vault.lock();

    await expect(vault.confirmRecoveryKey()).rejects.toMatchObject({
      code: "nothing_to_confirm",
    });
    await expect(vault.confirmRecoveryKeyRotation()).rejects.toMatchObject({
      code: "nothing_to_confirm",
    });
  });

  it("is trusted only once a device passphrase is set", async () => {
    const vault = new FakeKeyVault();
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    expect(vault.deviceTrustPending()).toBe(true);
    expect(await vault.hasKeysOnThisDevice()).toBe(false);

    await vault.trustThisDevice(FAKE_DEVICE_PASSPHRASE);

    expect(vault.deviceTrustPending()).toBe(false);
    expect(await new FakeKeyVault().hasKeysOnThisDevice()).toBe(true);
  });

  it("locks and unlocks on a trusted device with its passphrase", async () => {
    const vault = new FakeKeyVault();
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    await vault.trustThisDevice(FAKE_DEVICE_PASSPHRASE);

    vault.lock();
    expect(vault.isUnlocked).toBe(false);
    await expect(vault.unlock("not the passphrase")).rejects.toMatchObject({
      code: "wrong_device_passphrase",
    });
    expect(vault.isUnlocked).toBe(false);
    await vault.unlock(FAKE_DEVICE_PASSPHRASE);
    expect(vault.isUnlocked).toBe(true);
  });

  it("stays untrusted when the offer is declined or the app locks first", async () => {
    const declined = new FakeKeyVault();
    await declined.createAccountKeys();
    await declined.confirmRecoveryKey();
    declined.skipDeviceTrust();
    expect(declined.deviceTrustPending()).toBe(false);
    expect(await declined.hasKeysOnThisDevice()).toBe(false);

    await declined.unlockWithRecoveryKey(FAKE_RECOVERY_KEY);
    expect(declined.deviceTrustPending()).toBe(true);
    declined.lock();
    expect(declined.deviceTrustPending()).toBe(false);
  });

  it("starts locked after a reload even on a trusted device", async () => {
    const first = new FakeKeyVault();
    await first.createAccountKeys();
    await first.confirmRecoveryKey();

    expect(new FakeKeyVault().isUnlocked).toBe(false);
  });

  it("a new device needs the recovery key, in any case and spacing", async () => {
    const vault = new FakeKeyVault();
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    vault.forgetThisDevice();
    expect(await vault.hasKeysOnThisDevice()).toBe(false);

    await vault.unlockWithRecoveryKey("  fake-key0-not0-real-0000-test ");

    expect(vault.isUnlocked).toBe(true);
    expect(vault.deviceTrustPending()).toBe(true);
  });

  it("rejects a wrong recovery key and stays locked", async () => {
    const vault = new FakeKeyVault();
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();
    vault.lock();

    await expect(
      vault.unlockWithRecoveryKey("WRONG-KEY"),
    ).rejects.toBeInstanceOf(VaultError);
    expect(vault.isUnlocked).toBe(false);
  });

  it("replaces the recovery key only on confirmation", async () => {
    const vault = new FakeKeyVault();
    await vault.createAccountKeys();
    await vault.confirmRecoveryKey();

    await expect(
      vault.beginRecoveryKeyRotation("WRONG-KEY"),
    ).rejects.toMatchObject({ code: "wrong_recovery_key" });
    expect(await vault.beginRecoveryKeyRotation(FAKE_RECOVERY_KEY)).toBe(
      FAKE_ROTATED_RECOVERY_KEY,
    );
    await vault.unlockWithRecoveryKey(FAKE_RECOVERY_KEY);

    await vault.confirmRecoveryKeyRotation();
    // Replacing the recovery key does not ask about this device.
    expect(vault.deviceTrustPending()).toBe(false);

    await expect(
      vault.unlockWithRecoveryKey(FAKE_RECOVERY_KEY),
    ).rejects.toMatchObject({ code: "wrong_recovery_key" });
    await vault.unlockWithRecoveryKey(FAKE_ROTATED_RECOVERY_KEY);
  });

  it("normalises a typed key", () => {
    expect(normaliseRecoveryKey(" ab cd\n")).toBe("ABCD");
  });
});

describe("stand-ins for builds without real services", () => {
  it("auth refuses everything except reporting signed-out and signing out", async () => {
    const auth = new UnavailableAuthClient();

    expect(await auth.isSignedIn()).toBe(false);
    expect(await auth.currentSession()).toBeUndefined();
    await expect(auth.signOut()).resolves.toBeUndefined();
    for (const attempt of [
      auth.register(),
      auth.completeVerification(),
      auth.signIn(),
      auth.requestPasswordReset(),
      auth.completePasswordReset(),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  it("vault holds nothing and refuses to create or unlock", async () => {
    const vault = new UnavailableKeyVault();

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    expect(() => {
      vault.lock();
    }).not.toThrow();
    expect(await vault.fingerprint()).toBeUndefined();
    expect(vault.deviceTrustPending()).toBe(false);
    expect(() => {
      vault.skipDeviceTrust();
    }).not.toThrow();
    for (const attempt of [
      vault.accountHasKeys(),
      vault.createAccountKeys(),
      vault.confirmRecoveryKey(),
      vault.unlock(),
      vault.trustThisDevice(),
      vault.unlockWithRecoveryKey(),
      vault.beginRecoveryKeyRotation(),
      vault.confirmRecoveryKeyRotation(),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "unavailable" });
    }
  });
});

describe("createAuthClient", () => {
  const CONFIGURED = {
    VITE_SUPABASE_URL: "https://project.example",
    VITE_SUPABASE_PUBLISHABLE_KEY: ["sb", "publishable", "synthetic"].join("_"),
  };
  const double = (): FakeAuthClient => new FakeAuthClient();

  it.each(["production", "development"])(
    "uses the real client in a %s build configured with a project",
    (MODE) => {
      const makeDouble = MODE === "production" ? undefined : double;

      expect(
        createAuthClient({ ...CONFIGURED, MODE }, makeDouble),
      ).toBeInstanceOf(SupabaseAuthClient);
    },
  );

  it("never uses the real client in the e2e build, whatever is configured", () => {
    expect(
      createAuthClient({ ...CONFIGURED, MODE: "e2e" }, double),
    ).toBeInstanceOf(FakeAuthClient);
  });

  it("uses the in-memory double in an unconfigured development build", () => {
    expect(createAuthClient({ MODE: "development" }, double)).toBeInstanceOf(
      FakeAuthClient,
    );
    expect(
      createAuthClient(
        { MODE: "test", VITE_SUPABASE_URL: "https://project.example" },
        double,
      ),
    ).toBeInstanceOf(FakeAuthClient);
  });

  it("says accounts are unavailable in an unconfigured production build", () => {
    expect(createAuthClient({ MODE: "production" })).toBeInstanceOf(
      UnavailableAuthClient,
    );
  });

  it("has no double to fall back on when none is supplied, even in e2e mode", () => {
    expect(createAuthClient({ MODE: "e2e" })).toBeInstanceOf(
      UnavailableAuthClient,
    );
  });
});

describe("createKeyVault", () => {
  const CONFIGURED = {
    VITE_SUPABASE_URL: "https://project.example",
    VITE_SUPABASE_PUBLISHABLE_KEY: ["sb", "publishable", "synthetic"].join("_"),
  };
  const auth = new FakeAuthClient();

  it("runs the real vault on the in-memory stores when they are supplied", () => {
    const vault = createKeyVault(CONFIGURED, auth, {
      envelopes: new FakeRecoveryEnvelopeStore(),
      device: new IndexedDbDeviceKeyStore("warmly-device-test"),
    });

    expect(vault).toBeInstanceOf(AccountVault);
  });

  it("runs the real vault on the API in a configured production build", async () => {
    const vault = createKeyVault(
      { ...CONFIGURED, VITE_API_ORIGIN: "https://api.example" },
      auth,
    );

    expect(vault).toBeInstanceOf(AccountVault);
    // No device store until trusted-device unlock exists.
    expect(await vault.hasKeysOnThisDevice()).toBe(false);
  });

  it.each([{}, { VITE_API_ORIGIN: "" }, { VITE_API_ORIGIN: 7 }])(
    "is unavailable when signed-in accounts are configured but the API origin is not (%j)",
    (extra) => {
      expect(createKeyVault({ ...CONFIGURED, ...extra }, auth)).toBeInstanceOf(
        UnavailableKeyVault,
      );
    },
  );

  it("is unavailable in a production build with no backend configured", () => {
    expect(createKeyVault({}, auth)).toBeInstanceOf(UnavailableKeyVault);
  });
});

describe("createServices", () => {
  it("uses the in-memory doubles outside production builds", () => {
    const services = createServices();

    expect(services.auth).toBeInstanceOf(FakeAuthClient);
    expect(services.vault).toBeInstanceOf(AccountVault);
    expect(services.session.state).toBe("signed_out");
    expect(services.onboarding.recoveryKey).toBeUndefined();
  });
});

describe("describeError", () => {
  it.each([
    [new AuthError("invalid_credentials"), "don't match"],
    [new AuthError("email_not_verified"), "isn't verified yet"],
    [new AuthError("unavailable"), "aren't available in this version"],
    [new AuthError("weak_password"), "too easy to guess"],
    [new AuthError("rate_limited"), "Wait a few minutes"],
    [new AuthError("offline"), "Check your connection"],
    [new AuthError("reset_link_invalid"), "Ask for a new one"],
    [new VaultError("wrong_recovery_key"), "recovery key didn't work"],
    [new VaultError("no_keys_on_device"), "Use your recovery key instead"],
    [new VaultError("recovery_key_mistyped"), "has a typo somewhere"],
    [new VaultError("recovery_key_malformed"), "14 groups of 4"],
    [new VaultError("no_account_keys"), "hasn't finished setting up"],
    [new VaultError("wrong_device_passphrase"), "didn't unlock this device"],
    [new VaultError("device_store_damaged"), "has been removed"],
    [new VaultError("device_locked_out"), "too many wrong passphrases"],
    [new VaultError("nothing_to_trust"), "set this device up"],
    [new VaultError("keys_already_exist"), "already set up on another device"],
    [
      new VaultError("recovery_key_changed_elsewhere"),
      "Your existing key still works",
    ],
    [new VaultError("nothing_to_confirm"), "Start again"],
    [new VaultError("signed_out"), "Sign in again"],
    [new VaultError("offline"), "Check your connection"],
  ])("explains %s", (error, expected) => {
    expect(describeError(error)).toContain(expected);
  });

  it("never shows the detail of an unexpected failure", () => {
    const message = describeError(new Error("SECRET internal detail"));

    expect(message).toBe(
      "Something went wrong and nothing was changed. Try again in a moment.",
    );
  });

  it("handles a thrown non-error", () => {
    expect(describeError("boom")).toContain("Something went wrong");
  });
});
