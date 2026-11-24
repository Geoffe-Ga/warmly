import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { ACCOUNT, onboard } from "./account";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("onboarding (AC-01, AC-23, DEV-006)", () => {
  test("a new user registers, saves the recovery key and reaches Home", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Create your account",
    );
    await expectNoViolations(page);

    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Check your email",
    );
    await expectNoViolations(page);

    await page.getByRole("button", { name: "I've opened the link" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Save your recovery key",
    );
    await expect(page.getByText("cannot be recovered by anyone")).toBeVisible();
    await expectNoViolations(page);

    const recoveryKey = await page.getByTestId("recovery-key").innerText();
    await page
      .getByLabel("Type the last group of your key")
      .fill(recoveryKey.trim().split("-").at(-1) ?? "");
    await page.getByRole("button", { name: "I've saved my key" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Warmly");
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link")).toHaveText([
      "Journal",
      "Reflect",
      "Prepare for a Conversation",
    ]);
    await expectNoViolations(page);
  });

  test("invalid input is explained and focus moves to the first bad field", async ({
    page,
  }) => {
    await page.goto("/welcome");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await expectNoViolations(page);
  });

  test("the recovery key is gone after a reload and is never shown again", async ({
    page,
  }) => {
    await page.goto("/welcome");
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("button", { name: "I've opened the link" }).click();
    await expect(page.getByTestId("recovery-key")).toBeVisible();

    await page.reload();

    await expect(page.getByTestId("recovery-key")).toHaveCount(0);
    await expect(page.getByText("shown only once")).toBeVisible();
  });
});

test.describe("lock, unlock and sign out (AC-21, DEV-005)", () => {
  test("Lock hides the private screen at once and Unlock brings Home back", async ({
    page,
  }) => {
    await onboard(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Journal" })
      .click();
    await expect(page.getByText("Your entries in date order")).toBeVisible();

    await page.getByRole("button", { name: "Lock" }).click();

    await expect(page).toHaveURL(/\/locked$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(page.getByText("Your entries in date order")).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expectNoViolations(page);

    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });

  test("Back after locking does not reveal the private screen", async ({
    page,
  }) => {
    await onboard(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Journal" })
      .click();
    await page.getByRole("button", { name: "Lock" }).click();

    await page.goBack();

    await expect(page.getByText("Your entries in date order")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
  });

  test("a reload keeps the user signed in but locked", async ({ page }) => {
    await onboard(page);

    await page.goto("/journal");

    await expect(page).toHaveURL(/\/locked$/);
    await expect(page.getByText("Your entries in date order")).toHaveCount(0);
  });

  test("signing out returns to sign in, and the account can sign in again", async ({
    page,
  }) => {
    await onboard(page);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });

  test("a wrong password and the recovery and reset screens are accessible", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password").fill("the wrong password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("don't match");
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(
      page.getByText("It does not unlock your journal"),
    ).toBeVisible();
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByText("If that address has an account"),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("a reset link sets a new password that signs in but does not unlock", async ({
    page,
  }) => {
    const newPassword = ["staple", "window", "orange"].join(" ");
    await onboard(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByText("If that address has an account"),
    ).toBeVisible();

    // The doubles send no email: opening the page stands in for the link.
    await page.goto("/sign-in/new-password");
    await expect(
      page.getByRole("heading", { level: 1, name: "Choose a new password" }),
    ).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel("New password").fill("short");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByText("Use at least 12 characters")).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(
      page.getByText("Sign in with your new password"),
    ).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password").fill(newPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Signed in, but the journal is still locked: a password never unlocks.
    await expect(
      page.getByRole("heading", { level: 1, name: "Warmly is locked" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      0,
    );
  });

  test("a used reset link is refused with a way forward", async ({ page }) => {
    await page.goto("/sign-in/new-password");
    await page
      .getByLabel("New password")
      .fill(["staple", "window", "orange"].join(" "));
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "expired or was already used",
    );
    await expectNoViolations(page);
    await page.getByRole("link", { name: "Send a new one" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Reset your password" }),
    ).toBeVisible();
  });

  test("the recovery-key screen unlocks and is accessible", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("button", { name: "Lock" }).click();
    await page
      .getByRole("link", { name: "Use your recovery key instead" })
      .click();
    await expectNoViolations(page);

    await page.getByLabel("Recovery key").fill("wrong-key");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("alert")).toContainText("didn't work");
    await expectNoViolations(page);

    await page.getByLabel("Recovery key").fill("fake-key0-not0-real-0000-test");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });
});
