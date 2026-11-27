/**
 * The sync status in the browser (PRD SYNC-002, SYNC-010; AC-23).
 *
 * The `e2e` build syncs with a server that lives inside the page, so the
 * real engine and protocol run and nothing leaves the browser: the fixture
 * fails any test that contacts another host.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard, openMenu } from "./account";

const PROMPTS = [
  "What's going well?",
  "What would you like to improve?",
  "Since your last journal entry, how has your partner helped you feel loved?",
];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("sync status", () => {
  // The status line is a polite live region and passes axe (PRD AC-23).
  test("sends changes on its own, shows what is waiting while offline, and says nothing private", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const status = page.locator(".sync-status [role=status]");
    await expect(status).toHaveText("All changes saved");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expectNoViolations(page);

    // Writing an entry queues a change, which is sent on its own shortly
    // afterwards.
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("CANARY synthetic private answer");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(status).toHaveText("All changes saved");
    await expect(status).not.toContainText("CANARY");

    // Offline: the change waits, and the status says how many, not what.
    await context.setOffline(true);
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await page.getByLabel(PROMPTS[0] ?? "").fill("CANARY rewritten offline");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await openMenu(page);
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(status).toHaveText("1 change waiting to sync");
    await expect(status).not.toContainText("CANARY");
    await expect(page.locator(".offline-notice")).toHaveText(
      "Offline: your writing is saved on this device.",
    );
    await expectNoViolations(page);

    // Back online, a sync runs by itself.
    await context.setOffline(false);
    await expect(status).toHaveText("All changes saved");
  });

  test("is not shown before the app is unlocked", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.locator(".sync-status")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  });
});
