import { cleanup, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VaultError } from "../../../src/crypto/key-vault";
import {
  FAKE_DEVICE_PASSPHRASE,
  FAKE_RECOVERY_KEY,
  FAKE_ROTATED_RECOVERY_KEY,
} from "../../../src/testing/fake-key-vault";

import {
  ACCOUNT,
  heading,
  renderApp,
  setUpKeys,
  testServices,
} from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

async function fill(label: string, value: string): Promise<void> {
  // Waits for the field: some screens show it only after an async check.
  await userEvent.type(await screen.findByLabelText(label), value);
}

async function press(name: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name }));
}

/**
 * Wait until the app has arrived on a screen: its heading is shown and has
 * received focus. Waiting for focus matters, because typing that starts
 * before the app moves focus to the heading would be cut short.
 */
async function onHeading(text: string): Promise<void> {
  await waitFor(() => {
    expect(heading().textContent).toBe(text);
    expect(document.activeElement).toBe(heading());
  });
}

/** Arrive at the offer to trust this device, decline it, and reach Home. */
async function declineDeviceTrust(): Promise<void> {
  await onHeading("Unlock this device more easily");
  await press("Not now");
  await onHeading("Warmly");
}

describe("onboarding (AC-01, DEV-006)", () => {
  it("registers, verifies, confirms the recovery key and reaches Home", async () => {
    const services = await renderApp("/welcome");

    await fill("Email", ACCOUNT.email);
    await fill("Password", ACCOUNT.password);
    await press("Create account");
    await onHeading("Check your email");

    await press("I've opened the link");
    await onHeading("Save your recovery key");
    expect(services.session.state).toBe("signed_in_locked");
    expect(screen.getByTestId("recovery-key").textContent).toBe(
      FAKE_RECOVERY_KEY,
    );

    await fill("Type the last group of your key", "test");
    await press("I've saved my key");
    await declineDeviceTrust();

    expect(services.session.state).toBe("unlocked");
    expect(window.location.pathname).toBe("/");
    expect(services.onboarding.recoveryKey).toBeUndefined();
  });

  it("says plainly that losing the key and every device loses the journal", async () => {
    const services = testServices("signed_in_locked");
    services.onboarding.holdRecoveryKey(FAKE_RECOVERY_KEY);

    await renderApp("/welcome/recovery-key", services);

    expect(screen.getByText(/cannot be recovered by anyone/)).toBeDefined();
    expect(
      screen.getByText(/Resetting your password does not replace this key/),
    ).toBeDefined();
  });

  it("does not continue until the last group of the key is typed back", async () => {
    const services = testServices("signed_in_locked");
    services.onboarding.holdRecoveryKey(FAKE_RECOVERY_KEY);
    await renderApp("/welcome/recovery-key", services);

    await fill("Type the last group of your key", "nope");
    await press("I've saved my key");

    const field = screen.getByLabelText("Type the last group of your key");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/doesn't match the last group/)).toBeDefined();
    expect(document.activeElement).toBe(field);
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("never shows the key again once it has left memory", async () => {
    await renderApp("/welcome/recovery-key", testServices("signed_in_locked"));

    expect(screen.queryByTestId("recovery-key")).toBeNull();
    expect(screen.getByText(/shown only once and is not kept/)).toBeDefined();
  });

  it("explains invalid fields and focuses the first one", async () => {
    await renderApp("/welcome");

    await fill("Email", "not-an-email");
    await fill("Password", "short");
    await press("Create account");

    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/like name@example.com/)).toBeDefined();
    expect(screen.getByText("Use at least 12 characters.")).toBeDefined();
    expect(document.activeElement).toBe(email);
    expect(heading().textContent).toBe("Create your account");
  });

  it("tells the user the password does not unlock the journal", async () => {
    await renderApp("/welcome");

    expect(screen.getByText(/does not unlock your journal/)).toBeDefined();
  });

  it("can retry key creation after it fails, without verifying again", async () => {
    const services = testServices();
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    const createKeys = services.vault.createAccountKeys.bind(services.vault);
    let attempts = 0;
    services.vault.createAccountKeys = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("storage unavailable"))
        : createKeys();
    };
    await renderApp("/welcome/verify", services);

    await press("I've opened the link");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Something went wrong",
    );
    expect(heading().textContent).toBe("Check your email");
    expect(services.session.state).toBe("signed_out");

    await press("I've opened the link");
    await onHeading("Save your recovery key");

    expect(attempts).toBe(2);
    expect(screen.queryByText(/couldn't confirm your email/)).toBeNull();
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("stays on the verify screen when the email is not verified yet", async () => {
    const services = await renderApp("/welcome/verify");

    await press("I've opened the link");

    expect(
      await screen.findByText(/couldn't confirm your email/),
    ).toBeDefined();
    expect(services.session.state).toBe("signed_out");
    expect(heading().textContent).toBe("Check your email");
  });
});

describe("the recovery key never outlives its onboarding (DEV-006)", () => {
  async function atRecoveryKeyScreen() {
    const services = await renderApp("/welcome");
    await fill("Email", ACCOUNT.email);
    await fill("Password", ACCOUNT.password);
    await press("Create account");
    await onHeading("Check your email");
    await press("I've opened the link");
    await onHeading("Save your recovery key");
    return services;
  }

  it("is forgotten on sign out, so the next account cannot see it", async () => {
    const services = await atRecoveryKeyScreen();
    expect(services.onboarding.recoveryKey).toBe(FAKE_RECOVERY_KEY);

    await press("Sign out");
    await onHeading("Sign in");
    expect(services.onboarding.recoveryKey).toBeUndefined();
    expect(services.onboarding.emailVerified).toBe(false);

    // Someone else now signs in on this device and opens the screen directly.
    cleanup();
    services.session.signIn();
    await renderApp("/welcome/recovery-key", services);

    expect(screen.queryByTestId("recovery-key")).toBeNull();
    expect(document.body.textContent).not.toContain(FAKE_RECOVERY_KEY);
  });

  it("is forgotten when the app is locked", async () => {
    const services = testServices("unlocked");
    services.onboarding.holdRecoveryKey(FAKE_RECOVERY_KEY);
    await services.vault.createAccountKeys();
    await renderApp("/journal", services);

    await press("Lock");
    await onHeading("Warmly is locked");

    expect(services.onboarding.recoveryKey).toBeUndefined();
  });

  it("stays on screen if saving the keys fails, so it can be tried again", async () => {
    const services = await atRecoveryKeyScreen();
    const confirm = services.vault.confirmRecoveryKey.bind(services.vault);
    let attempts = 0;
    services.vault.confirmRecoveryKey = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new VaultError("offline"))
        : confirm();
    };

    await fill("Type the last group of your key", "test");
    await press("I've saved my key");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Check your connection",
    );
    expect(screen.getByTestId("recovery-key").textContent).toBe(
      FAKE_RECOVERY_KEY,
    );
    expect(services.session.state).toBe("signed_in_locked");
    expect(await services.vault.accountHasKeys()).toBe(false);

    await press("I've saved my key");
    await declineDeviceTrust();
    expect(services.session.state).toBe("unlocked");
  });

  it("the keys are not saved until the user confirms the recovery key", async () => {
    const services = await atRecoveryKeyScreen();

    expect(await services.vault.accountHasKeys()).toBe(false);
    expect(await services.vault.hasKeysOnThisDevice()).toBe(false);
  });

  it("is forgotten once confirmed", async () => {
    const services = await atRecoveryKeyScreen();

    await fill("Type the last group of your key", "test");
    await press("I've saved my key");
    await declineDeviceTrust();

    expect(services.onboarding.recoveryKey).toBeUndefined();
  });
});

describe("sign in, unlock and recover", () => {
  async function existingAccount(trustedDevice: boolean) {
    const services = testServices();
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    await services.auth.completeVerification();
    await services.auth.signOut();
    await setUpKeys(services.vault);
    services.vault.lock();
    if (!trustedDevice) {
      services.vault.forgetThisDevice();
    }
    return services;
  }

  it("signs in on a trusted device and unlocks there", async () => {
    const services = await renderApp("/sign-in", await existingAccount(true));

    await fill("Email", ACCOUNT.email);
    await fill("Password", ACCOUNT.password);
    await press("Sign in");
    await onHeading("Warmly is locked");
    expect(services.session.state).toBe("signed_in_locked");

    await fill("Device passphrase", FAKE_DEVICE_PASSPHRASE);
    await press("Unlock");
    await onHeading("Warmly");

    expect(services.session.state).toBe("unlocked");
    expect(services.vault.isUnlocked).toBe(true);
  });

  it("signs in on a new device and asks for the recovery key (AC-18)", async () => {
    const services = await renderApp("/sign-in", await existingAccount(false));

    await fill("Email", ACCOUNT.email);
    await fill("Password", ACCOUNT.password);
    await press("Sign in");
    await onHeading("Unlock with your recovery key");

    await fill("Recovery key", " fake-key0-not0-real-0000-test ");
    await press("Unlock");
    await declineDeviceTrust();

    expect(services.session.state).toBe("unlocked");
  });

  it("signing in alone never unlocks: the password is not a key (DEV-006)", async () => {
    const services = await renderApp("/sign-in", await existingAccount(false));

    await fill("Email", ACCOUNT.email);
    await fill("Password", ACCOUNT.password);
    await press("Sign in");
    await onHeading("Unlock with your recovery key");

    expect(services.session.state).toBe("signed_in_locked");
    expect(services.vault.isUnlocked).toBe(false);
  });

  it("rejects a wrong recovery key without unlocking", async () => {
    const prepared = testServices("signed_in_locked");
    await setUpKeys(prepared.vault);
    prepared.vault.forgetThisDevice();
    const services = await renderApp("/recover", prepared);

    await fill("Recovery key", "WRONG-KEY0-0000");
    await press("Unlock");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That recovery key didn't work");
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("finishes setting up an account whose onboarding was abandoned", async () => {
    const services = testServices();
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    await services.auth.completeVerification();
    await services.auth.signOut();
    await renderApp("/sign-in", services);

    await fill("Email", ACCOUNT.email);
    await fill("Password", ACCOUNT.password);
    await press("Sign in");
    await onHeading("Save your recovery key");

    expect(screen.getByTestId("recovery-key").textContent).toBe(
      FAKE_RECOVERY_KEY,
    );
    expect(await services.vault.accountHasKeys()).toBe(false);
    await fill("Type the last group of your key", "TEST");
    await press("I've saved my key");
    await declineDeviceTrust();
    expect(await services.vault.accountHasKeys()).toBe(true);
  });

  it("explains an account that has no keys yet on the recovery screen", async () => {
    await renderApp("/recover", testServices("signed_in_locked"));

    await fill("Recovery key", FAKE_RECOVERY_KEY);
    await press("Unlock");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "hasn't finished setting up",
    );
  });

  it("requires a recovery key before trying", async () => {
    await renderApp("/recover", testServices("signed_in_locked"));

    await press("Unlock");

    expect(screen.getByText("Enter your recovery key.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["on this device", "/locked", "Unlock", "unlock"],
    ["with the recovery key", "/recover", "Unlock", "unlockWithRecoveryKey"],
  ] as const)(
    "locks the keys again if the session ends while unlocking %s",
    async (_name, path, button, method) => {
      const services = testServices("signed_in_locked");
      await setUpKeys(services.vault);
      services.vault.lock();
      const open = services.vault[method].bind(services.vault);
      services.vault[method] = async (key: string) => {
        await open(key);
        // A sign-out lands while the keys are being opened.
        services.session.signOut();
      };
      await renderApp(path, services);
      await fill(
        path === "/recover" ? "Recovery key" : "Device passphrase",
        path === "/recover" ? FAKE_RECOVERY_KEY : FAKE_DEVICE_PASSPHRASE,
      );

      await press(button);

      await waitFor(() => {
        expect(services.session.state).toBe("signed_out");
        expect(services.vault.isUnlocked).toBe(false);
      });
    },
  );

  it("offers only the recovery key on a device that cannot unlock on its own", async () => {
    await renderApp("/locked", testServices("signed_in_locked"));

    expect(
      await screen.findByText("This device needs your recovery key to unlock."),
    ).toBeDefined();
    expect(screen.queryByLabelText("Device passphrase")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Unlock with your recovery key" })
        .getAttribute("href"),
    ).toBe("/recover");
  });

  it("refuses a wrong device passphrase and stays locked", async () => {
    const services = testServices("signed_in_locked");
    await setUpKeys(services.vault);
    services.vault.lock();
    await renderApp("/locked", services);

    await fill("Device passphrase", "not the passphrase");
    await press("Unlock");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "didn't unlock this device",
    );
    expect(services.session.state).toBe("signed_in_locked");
    expect(services.vault.isUnlocked).toBe(false);
  });

  it("asks for the device passphrase before trying", async () => {
    const services = testServices("signed_in_locked");
    await setUpKeys(services.vault);
    services.vault.lock();
    await renderApp("/locked", services);

    await userEvent.click(
      await screen.findByRole("button", { name: "Unlock" }),
    );

    expect(screen.getByText("Enter this device's passphrase.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to the recovery key if the device cannot be checked", async () => {
    const services = testServices("signed_in_locked");
    services.vault.hasKeysOnThisDevice = () =>
      Promise.reject(new Error("storage blocked"));
    await renderApp("/locked", services);

    expect(
      await screen.findByRole("link", {
        name: "Unlock with your recovery key",
      }),
    ).toBeDefined();
  });

  it("gives the same message for a wrong password and an unknown email", async () => {
    await renderApp("/sign-in", await existingAccount(true));

    await fill("Email", ACCOUNT.email);
    await fill("Password", "the wrong password");
    await press("Sign in");
    const first = (await screen.findByRole("alert")).textContent;
    cleanup();

    await renderApp("/sign-in", await existingAccount(true));
    await fill("Email", "nobody@example.com");
    await fill("Password", "the wrong password");
    await press("Sign in");
    const second = (await screen.findByRole("alert")).textContent;

    expect(first).toBe(second);
    expect(first).toContain("don't match");
  });

  it("tells an unverified user to open the emailed link", async () => {
    const services = testServices();
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    await renderApp("/sign-in", services);

    await fill("Email", ACCOUNT.email);
    await fill("Password", ACCOUNT.password);
    await press("Sign in");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "isn't verified yet",
    );
  });

  it("requires both fields before signing in", async () => {
    await renderApp("/sign-in");

    await press("Sign in");

    expect(screen.getByText("Enter your password.")).toBeDefined();
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
  });
});

describe("password reset (DEV-006)", () => {
  it("confirms without revealing whether the address has an account", async () => {
    await renderApp("/sign-in/reset");

    await fill("Email", "anyone@example.com");
    await press("Send reset link");

    expect(
      await screen.findByText(/If that address has an account/),
    ).toBeDefined();
  });

  it("states that a new password does not unlock the journal", async () => {
    await renderApp("/sign-in/reset");

    expect(screen.getByText(/It does not unlock your journal/)).toBeDefined();
  });

  it("checks the address before sending", async () => {
    await renderApp("/sign-in/reset");

    await fill("Email", "nope");
    await press("Send reset link");

    expect(screen.getByText(/like name@example.com/)).toBeDefined();
    expect(screen.queryByText(/If that address has an account/)).toBeNull();
  });
});

describe("choosing a new password from the emailed link (DEV-006)", () => {
  const NEW_PASSWORD = ["staple", "window", "orange"].join(" ");

  async function accountWithResetRequested() {
    const services = testServices();
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    await services.auth.completeVerification();
    await services.auth.signOut();
    await setUpKeys(services.vault);
    services.vault.forgetThisDevice();
    await services.auth.requestPasswordReset(ACCOUNT.email);
    return services;
  }

  it("sets the password, leaves the user signed out and points to sign in", async () => {
    const services = await accountWithResetRequested();
    await renderApp("/sign-in/new-password", services);

    await fill("New password", NEW_PASSWORD);
    await press("Save new password");

    expect(
      await screen.findByText(/Sign in with your new password/),
    ).toBeDefined();
    expect(
      screen.getByText(/you still need\s+a device you already use/),
    ).toBeDefined();
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(services.session.state).toBe("signed_out");
    await expect(services.auth.isSignedIn()).resolves.toBe(false);

    await userEvent.click(screen.getByRole("link", { name: "Sign in" }));
    await onHeading("Sign in");
    await fill("Email", ACCOUNT.email);
    await fill("Password", NEW_PASSWORD);
    await press("Sign in");
    await onHeading("Unlock with your recovery key");
  });

  it("says the password does not unlock the journal", async () => {
    await renderApp("/sign-in/new-password");

    expect(screen.getByText(/it does not unlock your journal/)).toBeDefined();
  });

  it("checks the length before sending anything", async () => {
    const services = await accountWithResetRequested();
    await renderApp("/sign-in/new-password", services);

    await fill("New password", "short");
    await press("Save new password");

    expect(screen.getByText(/Use at least 12 characters/)).toBeDefined();
    expect(document.activeElement).toBe(screen.getByLabelText("New password"));
    // The link was not spent on the invalid attempt.
    await fill("New password", NEW_PASSWORD);
    await press("Save new password");
    expect(
      await screen.findByText(/Sign in with your new password/),
    ).toBeDefined();
  });

  it("explains an expired or used link and offers a new one", async () => {
    await renderApp("/sign-in/new-password");

    await fill("New password", NEW_PASSWORD);
    await press("Save new password");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "expired or was already used",
    );
    expect(
      screen.getByRole("link", { name: "Send a new one" }).getAttribute("href"),
    ).toBe("/sign-in/reset");
  });
});

describe("the locked screen shows nothing private (UI-008)", () => {
  it("has no navigation into private screens and no entry details", async () => {
    const services = testServices("signed_in_locked");
    await setUpKeys(services.vault);
    services.vault.lock();
    await renderApp("/locked", services);

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /journal|reflect|prepare/i }),
    ).toBeNull();
    expect(
      await screen.findByRole("link", {
        name: "Use your recovery key instead",
      }),
    ).toBeDefined();
  });
});

describe("replacing the recovery key (SEC-003)", () => {
  async function unlockedWithKeys() {
    const services = testServices("unlocked");
    await setUpKeys(services.vault);
    return services;
  }

  it("is reached from settings, which also shows the key fingerprint", async () => {
    await renderApp("/settings", await unlockedWithKeys());

    expect((await screen.findByTestId("key-fingerprint")).textContent).toMatch(
      /^[0-9a-f]{16}$/,
    );
    await userEvent.click(
      screen.getByRole("link", { name: "Replace your recovery key" }),
    );
    await onHeading("Replace your recovery key");
  });

  it("replaces the key only after the current key and the new one are confirmed", async () => {
    const services = await renderApp(
      "/settings/recovery-key",
      await unlockedWithKeys(),
    );

    await fill("Current recovery key", FAKE_RECOVERY_KEY.toLowerCase());
    await press("Continue");

    const shown = await screen.findByTestId("recovery-key");
    expect(shown.textContent).toBe(FAKE_ROTATED_RECOVERY_KEY);
    expect(screen.getByText(/It isn't active yet/)).toBeDefined();
    // Nothing has changed yet: the old key still opens the account.
    await expect(
      services.vault.unlockWithRecoveryKey(FAKE_RECOVERY_KEY),
    ).resolves.toBeUndefined();

    await fill("Type the last group of your new key", "next");
    await press("Replace my recovery key");

    expect(await screen.findByText(/only one that works now/)).toBeDefined();
    expect(document.body.textContent).not.toContain(FAKE_ROTATED_RECOVERY_KEY);
    await expect(
      services.vault.unlockWithRecoveryKey(FAKE_RECOVERY_KEY),
    ).rejects.toMatchObject({ code: "wrong_recovery_key" });
    await expect(
      services.vault.unlockWithRecoveryKey(FAKE_ROTATED_RECOVERY_KEY),
    ).resolves.toBeUndefined();
  });

  it("refuses a wrong current key and prepares nothing", async () => {
    await renderApp("/settings/recovery-key", await unlockedWithKeys());

    await fill("Current recovery key", "FAKE-KEY0-NOT0-REAL-0000-NOPE");
    await press("Continue");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "That recovery key didn't work",
    );
    expect(screen.queryByTestId("recovery-key")).toBeNull();
  });

  it("asks for the current key before trying", async () => {
    await renderApp("/settings/recovery-key", await unlockedWithKeys());

    await press("Continue");

    expect(screen.getByText("Enter your current recovery key.")).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Current recovery key"),
    );
  });

  it("does not replace the key until the new one is typed back correctly", async () => {
    const services = await renderApp(
      "/settings/recovery-key",
      await unlockedWithKeys(),
    );
    await fill("Current recovery key", FAKE_RECOVERY_KEY);
    await press("Continue");
    await screen.findByTestId("recovery-key");

    await fill("Type the last group of your new key", "oops");
    await press("Replace my recovery key");

    expect(screen.getByText(/doesn't match the last group/)).toBeDefined();
    await expect(
      services.vault.unlockWithRecoveryKey(FAKE_RECOVERY_KEY),
    ).resolves.toBeUndefined();
  });

  it("keeps the old key when the replacement cannot be saved", async () => {
    const services = await unlockedWithKeys();
    services.vault.confirmRecoveryKeyRotation = () =>
      Promise.reject(new VaultError("recovery_key_changed_elsewhere"));
    await renderApp("/settings/recovery-key", services);
    await fill("Current recovery key", FAKE_RECOVERY_KEY);
    await press("Continue");
    await screen.findByTestId("recovery-key");

    await fill("Type the last group of your new key", "NEXT");
    await press("Replace my recovery key");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your existing key still works",
    );
    await expect(
      services.vault.unlockWithRecoveryKey(FAKE_RECOVERY_KEY),
    ).resolves.toBeUndefined();
  });

  it("is a private screen", async () => {
    await renderApp("/settings/recovery-key", testServices("signed_in_locked"));

    expect(window.location.pathname).toBe("/locked");
  });
});

describe("trusting this device (DEV-005, ADR-0004)", () => {
  async function atTrustScreen() {
    const services = testServices("signed_in_locked");
    await setUpKeys(services.vault);
    services.vault.forgetThisDevice();
    await renderApp("/recover", services);
    await fill("Recovery key", FAKE_RECOVERY_KEY);
    await press("Unlock");
    await onHeading("Unlock this device more easily");
    return services;
  }

  it("is offered after the recovery key opens the journal", async () => {
    const services = await atTrustScreen();

    expect(services.session.state).toBe("unlocked");
    expect(screen.getByText(/It is not your account\s+password/)).toBeDefined();
    expect(
      screen.getByText(/recovery key still opens your journal/),
    ).toBeDefined();
  });

  it("sets a passphrase that then unlocks this device", async () => {
    const services = await atTrustScreen();

    await fill("Device passphrase", FAKE_DEVICE_PASSPHRASE);
    await fill("Type it again", FAKE_DEVICE_PASSPHRASE);
    await press("Trust this device");
    await onHeading("Warmly");
    expect(await services.vault.hasKeysOnThisDevice()).toBe(true);

    await press("Lock");
    await onHeading("Warmly is locked");
    await fill("Device passphrase", FAKE_DEVICE_PASSPHRASE);
    await press("Unlock");
    await onHeading("Warmly");
  });

  it("checks the length and that both entries match, and saves nothing until they do", async () => {
    const services = await atTrustScreen();

    await fill("Device passphrase", "short");
    await fill("Type it again", "shorter");
    await press("Trust this device");

    expect(screen.getByText("Use at least 8 characters.")).toBeDefined();
    expect(screen.getByText(/two passphrases don't match/)).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Device passphrase"),
    );
    expect(await services.vault.hasKeysOnThisDevice()).toBe(false);
  });

  it("can be declined, leaving the device needing the recovery key", async () => {
    const services = await atTrustScreen();

    await press("Not now");
    await onHeading("Warmly");

    expect(services.vault.deviceTrustPending()).toBe(false);
    expect(await services.vault.hasKeysOnThisDevice()).toBe(false);
  });

  it("says so when there is nothing to set up", async () => {
    const services = testServices("unlocked");
    await renderApp("/unlock/trust-device", services);

    expect(screen.getByText(/Nothing to set up right now/)).toBeDefined();
    expect(screen.queryByLabelText("Device passphrase")).toBeNull();
  });

  it("is a private screen", async () => {
    await renderApp("/unlock/trust-device", testServices("signed_in_locked"));

    expect(window.location.pathname).toBe("/locked");
  });
});
