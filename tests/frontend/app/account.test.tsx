import { cleanup, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FAKE_RECOVERY_KEY } from "../../../src/testing/fake-key-vault";

import { ACCOUNT, heading, renderApp, testServices } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

async function fill(label: string, value: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(label), value);
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
    await onHeading("Warmly");

    expect(services.session.state).toBe("unlocked");
    expect(window.location.pathname).toBe("/");
    expect(services.onboarding.recoveryKey).toBeUndefined();
  });

  it("says plainly that losing the key and every device loses the journal", async () => {
    const services = testServices("signed_in_locked");
    services.onboarding.recoveryKey = FAKE_RECOVERY_KEY;

    await renderApp("/welcome/recovery-key", services);

    expect(screen.getByText(/cannot be recovered by anyone/)).toBeDefined();
    expect(
      screen.getByText(/Resetting your password does not replace this key/),
    ).toBeDefined();
  });

  it("does not continue until the last group of the key is typed back", async () => {
    const services = testServices("signed_in_locked");
    services.onboarding.recoveryKey = FAKE_RECOVERY_KEY;
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

describe("sign in, unlock and recover", () => {
  async function existingAccount(trustedDevice: boolean) {
    const services = testServices();
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    await services.auth.completeVerification();
    await services.auth.signOut();
    if (trustedDevice) {
      await services.vault.createAccountKeys();
      services.vault.lock();
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
    await onHeading("Warmly");

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
    const services = await renderApp(
      "/recover",
      testServices("signed_in_locked"),
    );

    await fill("Recovery key", "WRONG-KEY0-0000");
    await press("Unlock");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That recovery key didn't work");
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("requires a recovery key before trying", async () => {
    await renderApp("/recover", testServices("signed_in_locked"));

    await press("Unlock");

    expect(screen.getByText("Enter your recovery key.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a device that cannot unlock on its own", async () => {
    await renderApp("/locked", testServices("signed_in_locked"));

    await press("Unlock");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Use your recovery key instead");
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

describe("the locked screen shows nothing private (UI-008)", () => {
  it("has no navigation into private screens and no entry details", async () => {
    await renderApp("/locked", testServices("signed_in_locked"));

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /journal|reflect|prepare/i }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Use your recovery key instead" }),
    ).toBeDefined();
  });
});
