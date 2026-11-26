/**
 * The recovery key in the browser (PRD SEC-003, DEV-001 path B, DEV-006;
 * AC-01, AC-18).
 *
 * These run the real cryptography. Only the transport is a double: the
 * `e2e` build keeps the "server's" copy of accounts and recovery envelopes in
 * `localStorage`, which every tab shares, and each device's own state in
 * `sessionStorage`, which a tab keeps to itself. A second tab is therefore a
 * second device signing in to the same account, and it stays inside the
 * fixture's network and CSP guards.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import {
  ACCOUNT,
  declineDeviceTrust,
  keyFingerprint,
  lastGroup,
  onboard,
  openInApp,
  openMenu,
  signIn,
} from "./account";

const KEY_SHAPE = /^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/;
const NEW_PASSWORD = ["staple", "window", "orange"].join(" ");

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("recovering on a second device", () => {
  test("the recovery key opens the same account key on a new device", async ({
    page,
    context,
  }) => {
    const recoveryKey = await onboard(page);
    expect(recoveryKey).toMatch(KEY_SHAPE);
    const fingerprint = await keyFingerprint(page);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const second = await context.newPage();
    await signIn(second);
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "Unlock with your recovery key",
    );
    await expectNoViolations(second);

    // Typed the way a person would: lower case, spaces for dashes.
    await second
      .getByLabel("Recovery key")
      .fill(recoveryKey.toLowerCase().replaceAll("-", " "));
    await second.getByRole("button", { name: "Unlock" }).click();
    await declineDeviceTrust(second);
    await expect(
      second.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();

    expect(await keyFingerprint(second)).toBe(fingerprint);
    await expectNoViolations(second);
  });

  test("a typo is caught before anything is tried, and a wrong key is refused", async ({
    page,
    context,
  }) => {
    const recoveryKey = await onboard(page);
    const second = await context.newPage();
    await signIn(second);

    const typo =
      (recoveryKey.startsWith("Z") ? "Y" : "Z") + recoveryKey.slice(1);
    await second.getByLabel("Recovery key").fill(typo);
    await second.getByRole("button", { name: "Unlock" }).click();
    await expect(second.getByRole("alert")).toContainText("has a typo");
    await expectNoViolations(second);

    await second.getByLabel("Recovery key").fill("not a recovery key");
    await second.getByRole("button", { name: "Unlock" }).click();
    await expect(second.getByRole("alert")).toContainText("14 groups of 4");

    await expect(second).toHaveURL(/\/recover$/);
    await expect(
      second.getByRole("navigation", { name: "Primary" }),
    ).toHaveCount(0);
  });

  test("the server's copy holds no recovery key and no readable account key", async ({
    page,
  }) => {
    const recoveryKey = await onboard(page);

    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage }),
    );

    expect(stored).toContain("warmly.fake.server.recovery");
    expect(stored).not.toContain(recoveryKey);
    expect(stored).not.toContain(recoveryKey.replaceAll("-", ""));
  });
});

test.describe("a password reset does not open the journal (AC-18)", () => {
  test("after a reset, a new device is signed in but can decrypt nothing without the key", async ({
    page,
    context,
  }) => {
    const recoveryKey = await onboard(page);
    await openMenu(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByText("If that address has an account"),
    ).toBeVisible();
    await page.goto("/sign-in/new-password");
    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(
      page.getByText("Sign in with your new password"),
    ).toBeVisible();

    const fresh = await context.newPage();
    await signIn(fresh, NEW_PASSWORD);
    await expect(fresh.getByRole("heading", { level: 1 })).toHaveText(
      "Unlock with your recovery key",
    );

    // The new password is not a key, and no private screen opens.
    await fresh.getByLabel("Recovery key").fill(NEW_PASSWORD);
    await fresh.getByRole("button", { name: "Unlock" }).click();
    await expect(fresh.getByRole("alert")).toContainText(
      "doesn't look like a recovery key",
    );
    await openInApp(fresh, "/journal");
    await expect(fresh).toHaveURL(/\/locked$/);
    await expect(
      fresh.getByText("This device needs your recovery key to unlock."),
    ).toBeVisible();
    await expect(fresh.getByRole("button", { name: "Unlock" })).toHaveCount(0);
    await expect(
      fresh.getByRole("navigation", { name: "Primary" }),
    ).toHaveCount(0);

    // The recovery key from before the reset still works: nothing about the
    // keys changed.
    await fresh
      .getByRole("link", { name: "Unlock with your recovery key" })
      .click();
    await fresh.getByLabel("Recovery key").fill(recoveryKey);
    await fresh.getByRole("button", { name: "Unlock" }).click();
    await declineDeviceTrust(fresh);
    await expect(
      fresh.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });
});

test.describe("an account whose onboarding was abandoned", () => {
  // Sign up, open the emailed link, save and confirm the recovery key,
  // and the app unlocks (part of PRD AC-01; no journal entry here).
  test("creates its keys at the next sign-in, and nothing was saved before", async ({
    page,
    context,
  }) => {
    await page.goto("/welcome");
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("button", { name: "I've opened the link" }).click();
    const abandoned = (
      await page.getByTestId("recovery-key").innerText()
    ).trim();
    await page.close();

    const later = await context.newPage();
    await signIn(later);
    await expect(later.getByRole("heading", { level: 1 })).toHaveText(
      "Save your recovery key",
    );
    const recoveryKey = (
      await later.getByTestId("recovery-key").innerText()
    ).trim();
    expect(recoveryKey).not.toBe(abandoned);

    await later
      .getByLabel("Type the last group of your key")
      .fill(lastGroup(recoveryKey));
    await later.getByRole("button", { name: "I've saved my key" }).click();
    await declineDeviceTrust(later);
    await expect(
      later.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });
});

test.describe("replacing the recovery key", () => {
  test("the new key works on a new device and the old one no longer does", async ({
    page,
    context,
  }) => {
    const oldKey = await onboard(page);
    const fingerprint = await keyFingerprint(page);
    await page.getByRole("link", { name: "Replace your recovery key" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Replace your recovery key",
    );
    await expectNoViolations(page);

    await page.getByLabel("Current recovery key").fill(oldKey);
    await page.getByRole("button", { name: "Continue" }).click();
    const newKey = (await page.getByTestId("recovery-key").innerText()).trim();
    expect(newKey).toMatch(KEY_SHAPE);
    expect(newKey).not.toBe(oldKey);
    await expect(page.getByText("It isn't active yet")).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel("Type the last group of your new key").fill("0000");
    await page.getByRole("button", { name: "Replace my recovery key" }).click();
    await expect(page.getByText("doesn't match the last group")).toBeVisible();
    await page
      .getByLabel("Type the last group of your new key")
      .fill(lastGroup(newKey));
    await page.getByRole("button", { name: "Replace my recovery key" }).click();
    await expect(page.getByText("only one that works now")).toBeVisible();
    await expect(page.getByText(newKey)).toHaveCount(0);
    await expectNoViolations(page);

    const second = await context.newPage();
    await signIn(second);
    await second.getByLabel("Recovery key").fill(oldKey);
    await second.getByRole("button", { name: "Unlock" }).click();
    await expect(second.getByRole("alert")).toContainText(
      "That recovery key didn't work",
    );
    await second.getByLabel("Recovery key").fill(newKey);
    await second.getByRole("button", { name: "Unlock" }).click();
    await declineDeviceTrust(second);
    await expect(
      second.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    expect(await keyFingerprint(second)).toBe(fingerprint);
  });

  test("stopping part-way changes nothing", async ({ page, context }) => {
    const oldKey = await onboard(page);
    await openInApp(page, "/settings/recovery-key");
    await page.getByLabel("Current recovery key").fill(oldKey);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("recovery-key")).toBeVisible();
    await page
      .getByRole("link", { name: "Cancel and keep my current key" })
      .click();

    const second = await context.newPage();
    await signIn(second);
    await second.getByLabel("Recovery key").fill(oldKey);
    await second.getByRole("button", { name: "Unlock" }).click();
    await declineDeviceTrust(second);
    await expect(
      second.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });
});
