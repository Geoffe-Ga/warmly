import { beforeEach, describe, expect, it } from "vitest";

import { createServices } from "../../../src/app/services";
import {
  AuthError,
  UnavailableAuthClient,
} from "../../../src/auth/auth-client";
import { UnavailableKeyVault, VaultError } from "../../../src/crypto/key-vault";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import {
  FAKE_RECOVERY_KEY,
  FakeKeyVault,
  normaliseRecoveryKey,
} from "../../../src/testing/fake-key-vault";
import { describeError } from "../../../src/ui/screens/account/shared";

beforeEach(() => {
  sessionStorage.clear();
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
      new FakeAuthClient().requestPasswordReset(),
    ).resolves.toBeUndefined();
  });

  it("uses the storage it is given", async () => {
    const auth = new FakeAuthClient(localStorage);
    await auth.register("a@example.com", "a long password");

    expect(sessionStorage.length).toBe(0);
    localStorage.clear();
  });
});

describe("FakeKeyVault", () => {
  it("has no keys until an account is created", async () => {
    const vault = new FakeKeyVault();

    expect(await vault.hasKeysOnThisDevice()).toBe(false);
    await expect(vault.unlock()).rejects.toMatchObject({
      code: "no_keys_on_device",
    });
  });

  it("creates keys, locks and unlocks on a trusted device", async () => {
    const vault = new FakeKeyVault();

    expect(await vault.createAccountKeys()).toBe(FAKE_RECOVERY_KEY);
    expect(vault.isUnlocked).toBe(true);
    vault.lock();
    expect(vault.isUnlocked).toBe(false);
    await vault.unlock();
    expect(vault.isUnlocked).toBe(true);
    expect(await new FakeKeyVault().hasKeysOnThisDevice()).toBe(true);
  });

  it("starts locked after a reload even on a trusted device", async () => {
    await new FakeKeyVault().createAccountKeys();

    expect(new FakeKeyVault().isUnlocked).toBe(false);
  });

  it("accepts the recovery key in any case and spacing", async () => {
    const vault = new FakeKeyVault();

    await vault.unlockWithRecoveryKey(" fake-key0-not0-real-0000-test ");

    expect(vault.isUnlocked).toBe(true);
    expect(await vault.hasKeysOnThisDevice()).toBe(true);
  });

  it("rejects a wrong recovery key and stays locked", async () => {
    const vault = new FakeKeyVault();

    await expect(vault.unlockWithRecoveryKey("nope")).rejects.toMatchObject({
      code: "wrong_recovery_key",
    });
    expect(vault.isUnlocked).toBe(false);
  });

  it("normalises a typed key", () => {
    expect(normaliseRecoveryKey(" ab cd-ef ")).toBe("ABCD-EF");
  });
});

describe("stand-ins for builds without real services", () => {
  it("auth refuses everything except reporting signed-out and signing out", async () => {
    const auth = new UnavailableAuthClient();

    expect(await auth.isSignedIn()).toBe(false);
    await expect(auth.signOut()).resolves.toBeUndefined();
    for (const attempt of [
      auth.register(),
      auth.completeVerification(),
      auth.signIn(),
      auth.requestPasswordReset(),
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
    for (const attempt of [
      vault.createAccountKeys(),
      vault.unlock(),
      vault.unlockWithRecoveryKey(),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "unavailable" });
    }
  });
});

describe("createServices", () => {
  it("uses the in-memory doubles outside production builds", () => {
    const services = createServices();

    expect(services.auth).toBeInstanceOf(FakeAuthClient);
    expect(services.vault).toBeInstanceOf(FakeKeyVault);
    expect(services.session.state).toBe("signed_out");
    expect(services.onboarding.recoveryKey).toBeUndefined();
  });
});

describe("describeError", () => {
  it.each([
    [new AuthError("invalid_credentials"), "don't match"],
    [new AuthError("email_not_verified"), "isn't verified yet"],
    [new AuthError("unavailable"), "aren't available in this version"],
    [new VaultError("wrong_recovery_key"), "recovery key didn't work"],
    [new VaultError("no_keys_on_device"), "Use your recovery key instead"],
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
