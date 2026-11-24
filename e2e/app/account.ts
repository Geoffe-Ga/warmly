/**
 * Helpers for driving the account flows in the `e2e` build, which uses
 * in-memory doubles for authentication and key storage.
 */
import { expect, type Page } from "../fixtures/test";

// Assembled from words so no credential-shaped literal sits in the repository.
const SYNTHETIC_PHRASE = ["correct", "horse", "battery"].join(" ");

/** A synthetic account for the in-memory doubles. Nothing here is real. */
export const ACCOUNT = {
  email: "sam@example.com",
  password: SYNTHETIC_PHRASE,
};

/**
 * Create an account and finish onboarding, ending unlocked on Home.
 *
 * @param page - The page to drive.
 */
export async function onboard(page: Page): Promise<void> {
  await page.goto("/welcome");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "I've opened the link" }).click();

  const recoveryKey = await page.getByTestId("recovery-key").innerText();
  const lastGroup = recoveryKey.trim().split("-").at(-1) ?? "";
  await page.getByLabel("Type the last group of your key").fill(lastGroup);
  await page.getByRole("button", { name: "I've saved my key" }).click();

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
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
