/**
 * Updating the app while something is being written (PRD §8, REL-004;
 * AC-28).
 *
 * A new version is never switched to by itself, because the page reloads.
 * When the person asks for it, what they are writing is saved first.
 *
 * A browser test cannot publish a new build half-way through, so the `e2e`
 * build lets a test say that a version is waiting (see `src/main.tsx`).
 * Switching to it reloads the page exactly as the real one does. That the
 * service worker itself waits is the build setting `registerType: "prompt"`,
 * checked in `e2e/production/`.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/test";

import { onboard, unlockThisDevice } from "./account";

const FIRST_PROMPT = "What's going well?";
const WRITING = "Synthetic half-written thought";

test.describe("a new version of the app", () => {
  test("waits while a draft is being written, then updates without losing it", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    await page.getByLabel(FIRST_PROMPT).fill(WRITING);

    // A new version finishes downloading while the draft is open.
    let reloads = 0;
    page.on("load", () => {
      reloads += 1;
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event("warmly:test-update-ready"));
    });

    // It is announced, and nothing else happens: no reload, text untouched.
    const notice = page.locator(".update-notice");
    await expect(notice.getByRole("status")).toHaveText(
      "A new version of Warmly is ready.",
    );
    await page.getByLabel(FIRST_PROMPT).pressSequentially(", still typing");
    await expect(page.getByLabel(FIRST_PROMPT)).toHaveValue(
      `${WRITING}, still typing`,
    );
    expect(reloads).toBe(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);

    // The person asks for it straight away, before autosave has run.
    await notice.getByRole("button", { name: "Update now" }).click();
    await page.waitForEvent("load");
    expect(reloads).toBe(1);

    // After the reload the draft is there, saved by the update itself.
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page
      .getByRole("link", { name: /Carry on|Write a new entry/ })
      .click();
    await expect(page.getByLabel(FIRST_PROMPT)).toHaveValue(
      `${WRITING}, still typing`,
    );
    await expect(page.locator(".update-notice")).toBeHidden();
  });
});
