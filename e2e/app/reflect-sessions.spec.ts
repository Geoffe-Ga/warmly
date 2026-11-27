/**
 * Saved Reflect sessions in the browser (PRD RF-006, RF-007, RF-008;
 * AC-08).
 *
 * Sessions are encrypted and kept in IndexedDB, so they come back after a
 * reload. The stand-in provider sends nothing.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard, unlockThisDevice } from "./account";

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

async function openReflect(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Reflect" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reflect");
}

async function askInANewSession(page: Page, question: string): Promise<void> {
  await openReflect(page);
  await page.getByRole("link", { name: "Ask a question" }).click();
  await page
    .getByLabel("What would you like to ask about your journal?")
    .fill(question);
  await page.getByRole("button", { name: "Ask" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Send to Test provider" })
    .click();
  await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible();
  await page.getByRole("link", { name: "Warmly home" }).click();
}

function sessions(page: Page) {
  return page
    .getByRole("navigation", { name: "Your reflections" })
    .getByRole("link");
}

test.describe("saved reflections", () => {
  // A follow-up, a session resumed after a reload, and Finish making it
  // read-only (PRD AC-08).
  test("two sessions survive a reload; one is resumed, one finished and read-only, one deleted", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("Synthetic answer for the journal.");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await page.getByRole("link", { name: "Warmly home" }).click();

    await askInANewSession(page, "First synthetic question?");
    await askInANewSession(page, "Second synthetic question?");
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );

    // Reload: the app locks; after unlocking both are there, still open.
    await page.reload();
    await unlockThisDevice(page);
    await openReflect(page);
    await expect(sessions(page)).toHaveCount(2);
    await expect(sessions(page).filter({ hasText: "Open" })).toHaveCount(2);

    // Resume the first: ask more in it.
    await sessions(page)
      .filter({ hasText: "First synthetic question?" })
      .click();
    await expect(page.getByText("First synthetic question?")).toBeVisible();
    await page
      .getByLabel("What would you like to ask about your journal?")
      .fill("A follow-up?");
    await page.getByRole("button", { name: "Ask" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Send to Test provider" })
      .click();
    await expect(page.getByRole("heading", { name: "Answer" })).toHaveCount(2);

    // Finish it: read-only from then on, and it says why.
    await page.getByRole("button", { name: "Finish Reflection" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("you can't ask more in it");
    await expectNoViolations(page);
    await dialog.getByRole("button", { name: "Finish Reflection" }).click();
    await expect(
      page.getByText("This reflection is finished.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(0);
    await expect(page.getByText("A follow-up?")).toBeVisible();
    await expectNoViolations(page);

    // Delete the other, after the confirmation.
    await page.getByRole("link", { name: "Back to Reflect" }).click();
    await sessions(page)
      .filter({ hasText: "Second synthetic question?" })
      .click();
    await page.getByRole("button", { name: "Delete this reflection" }).click();
    await expect(dialog).toContainText("Your journal entries are not.");
    await dialog.getByRole("button", { name: "Delete reflection" }).click();
    await expect(
      page.getByText("The reflection has been removed from this device."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

    // One left, finished; and the journal entry is untouched.
    await page.getByRole("link", { name: "Back to Reflect" }).click();
    await expect(sessions(page)).toHaveCount(1);
    await expect(sessions(page)).toContainText("Finished");
    await expect(
      page.getByRole("navigation", { name: "Entries" }).getByRole("link"),
    ).toHaveCount(1);
  });
});
