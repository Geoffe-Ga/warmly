/**
 * Helpers for driving the account flows in the `e2e` build, which uses
 * in-memory doubles for authentication and key storage.
 */
import { expect, type Page } from "../fixtures/test";

// Assembled from words so no credential-shaped literal sits in the repository.
const SYNTHETIC_PHRASE = ["correct", "horse", "battery"].join(" ");

/** A synthetic device passphrase. */
export const DEVICE_PASSPHRASE = ["lamp", "river", "kettle"].join(" ");

/** A synthetic account for the in-memory doubles. Nothing here is real. */
export const ACCOUNT = {
  email: "sam@example.com",
  password: SYNTHETIC_PHRASE,
};

/**
 * Create an account and finish onboarding, ending unlocked on Home.
 *
 * @param page - The page to drive.
 * @param email - The account's email address, for a test with two accounts.
 * @returns The recovery key that was shown.
 */
export async function onboard(
  page: Page,
  email: string = ACCOUNT.email,
): Promise<string> {
  await page.goto("/welcome");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "I've opened the link" }).click();

  const recoveryKey = (
    await page.getByTestId("recovery-key").innerText()
  ).trim();
  await page
    .getByLabel("Type the last group of your key")
    .fill(lastGroup(recoveryKey));
  await page.getByRole("button", { name: "I've saved my key" }).click();
  await trustThisDevice(page);

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  return recoveryKey;
}

/**
 * On the offer to trust this device, set the device passphrase.
 *
 * @param page - The page showing the offer.
 */
export async function trustThisDevice(page: Page): Promise<void> {
  await page.getByLabel("Device passphrase").fill(DEVICE_PASSPHRASE);
  await page.getByLabel("Type it again").fill(DEVICE_PASSPHRASE);
  await page.getByRole("button", { name: "Trust this device" }).click();
}

/**
 * On the offer to trust this device, decline it.
 *
 * @param page - The page showing the offer.
 */
export async function declineDeviceTrust(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Not now" }).click();
}

/**
 * Unlock a trusted device from the locked screen.
 *
 * @param page - The page showing the locked screen.
 */
export async function unlockThisDevice(page: Page): Promise<void> {
  await page.getByLabel("Device passphrase").fill(DEVICE_PASSPHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
}

/**
 * The last dash-separated group of a recovery key.
 *
 * @param recoveryKey - The key as shown.
 * @returns Its final group.
 */
export function lastGroup(recoveryKey: string): string {
  return recoveryKey.split("-").at(-1) ?? "";
}

/**
 * Sign in on the sign-in screen with the given password.
 *
 * @param page - The page to drive.
 * @param password - The password to type.
 */
export async function signIn(
  page: Page,
  password: string = ACCOUNT.password,
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Read the account key fingerprint from Settings, without reloading.
 *
 * @param page - An unlocked page.
 * @returns The fingerprint shown.
 */
export async function keyFingerprint(page: Page): Promise<string> {
  await openInApp(page, "/settings");
  return (await page.getByTestId("key-fingerprint").innerText()).trim();
}

/**
 * Go to a path without reloading the page, as an in-app link would. A reload
 * would lock the app, because keys live in memory only.
 *
 * @param page - The page to drive.
 * @param path - The in-app path to open.
 */
export async function openInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState(null, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/**
 * Open the menu in the top bar, where the secondary navigation, Sync now
 * and Sign out are while unlocked.
 *
 * @param page - An unlocked page.
 */
export async function openMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu" }).click();
}
