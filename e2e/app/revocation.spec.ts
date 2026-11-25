/**
 * Removing a device (PRD DEV-003, DEV-004; AC-20).
 *
 * The `e2e` build keeps the "server's" device register in `localStorage`,
 * which every tab shares, and each tab's own device keys apart. A second tab
 * is therefore a second device of the same account, and the fake register
 * refuses a removed device exactly as the API does.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import {
  ACCOUNT,
  declineDeviceTrust,
  onboard,
  openInApp,
  signIn,
} from "./account";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

function deviceCards(page: Page) {
  return page.locator("section.card").filter({ hasText: "Added" });
}

async function openDevices(page: Page): Promise<void> {
  await openInApp(page, "/settings/devices");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Manage Devices",
  );
}

/** Join the account on a second device with the recovery key. */
async function joinWithRecoveryKey(page: Page, key: string): Promise<void> {
  await signIn(page);
  await page.getByLabel("Recovery key").fill(key);
  await page.getByRole("button", { name: "Unlock" }).click();
  await declineDeviceTrust(page);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

/** In the open dialog, type the password and confirm. */
async function confirmRemoval(page: Page, password: string): Promise<void> {
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Account password").fill(password);
  await dialog.getByRole("button", { name: "Remove device" }).click();
}

test.describe("removing a device", () => {
  test("removing another device: it is refused on its next request and told what happened", async ({
    page,
    context,
  }) => {
    const recoveryKey = await onboard(page);
    const second = await context.newPage();
    await joinWithRecoveryKey(second, recoveryKey);
    await openDevices(second);
    await expect(deviceCards(second)).toHaveCount(2);

    await openDevices(page);
    const other = deviceCards(page).filter({ hasNotText: "This device." });
    await other.getByRole("button", { name: /^Remove / }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("It will stop syncing straight away");
    await expect(dialog).toContainText("We cannot erase a device from here");
    await expectNoViolations(page);
    await confirmRemoval(page, ACCOUNT.password);

    await expect(
      page.getByText("That device can no longer sync or open your journal."),
    ).toBeVisible();
    await expect(deviceCards(page).filter({ hasText: "Removed." })).toHaveCount(
      1,
    );
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expectNoViolations(page);

    // The removed device's very next request is refused.
    await openInApp(second, "/settings");
    await openInApp(second, "/settings/devices");
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "This device was removed",
    );
    await expect(second).toHaveURL(/\/removed$/);
    await expect(second.getByText("Nothing was erased")).toBeVisible();
    await expect(
      second.getByRole("navigation", { name: "Primary" }),
    ).toHaveCount(0);
    await expectNoViolations(second);

    // It stays out: a reload shows the same explanation, and a private
    // screen sends it to sign in.
    await second.reload();
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "This device was removed",
    );
    await second.goto("/settings/devices");
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "Sign in",
    );

    // Coming back takes the recovery key again, and it joins as a new device.
    await joinWithRecoveryKey(second, recoveryKey);
    await openDevices(second);
    await expect(deviceCards(second)).toHaveCount(3);
    await expect(
      deviceCards(second).filter({ hasText: "Removed." }),
    ).toHaveCount(1);
    await expect(
      deviceCards(second).filter({ hasText: "This device." }),
    ).toHaveCount(1);
  });

  test("removing the device in use signs it out without showing anything private", async ({
    page,
  }) => {
    await onboard(page);
    await openDevices(page);

    await page.getByRole("button", { name: /^Remove / }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "This is the device you are using",
    );
    await confirmRemoval(page, ACCOUNT.password);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This device was removed",
    );
    await expect(deviceCards(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      0,
    );
    await expectNoViolations(page);

    // Private screens are closed to it.
    await page.goto("/settings/devices");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });

  test("a wrong password removes nothing, and cancelling closes the dialog", async ({
    page,
  }) => {
    await onboard(page);
    await openDevices(page);
    await page.getByRole("button", { name: /^Remove / }).click();

    await confirmRemoval(page, "not the password");

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("alert")).toContainText("don't match");
    await expectNoViolations(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(
      deviceCards(page).first().getByText("This device."),
    ).toBeVisible();
    await expect(deviceCards(page).filter({ hasText: "Removed." })).toHaveCount(
      0,
    );
  });
});
