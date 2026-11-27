/**
 * A reflection is removed when an entry it was built from is changed or
 * deleted (PRD DEP-002, DEP-003; AC-12, AC-03; invariant 6; ADR-0010).
 *
 * Two devices that reach the same result are covered by the unit tests,
 * which run the real store and sync engine against the in-memory server.
 * A browser test across two contexts needs a server both can reach, which
 * arrives with the real-stack tests (#63).
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard } from "./account";

const PROMPTS = [
  "What's going well?",
  "What would you like to improve?",
  "Since your last journal entry, how has your partner helped you feel loved?",
];
const REMOVED =
  "A reflection was removed because a journal entry it was built from was changed or deleted.";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function writeEntryAndAsk(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await page.getByRole("link", { name: "Write a new entry" }).click();
  await page.getByLabel(PROMPTS[0] ?? "").fill("We cooked dinner together.");
  await page.getByLabel(PROMPTS[1] ?? "").fill("Synthetic second answer.");
  await page.getByLabel(PROMPTS[2] ?? "").fill("Synthetic third answer.");
  await page.getByRole("button", { name: "Save entry" }).click();
  await expect(page.getByText("A journal entry.")).toBeVisible();
  await page.getByRole("link", { name: "Warmly home" }).click();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Reflect" })
    .click();
  await page.getByRole("link", { name: "Ask a question" }).click();
  await page
    .getByLabel("What would you like to ask about your journal?")
    .fill("What has gone well?");
  await page.getByRole("button", { name: "Ask" }).click();
  await page.getByRole("button", { name: "Send to Test provider" }).click();
  await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible();
}

async function expectNoReflections(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Warmly home" }).click();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Reflect" })
    .click();
  await expect(
    page.getByText("You have no saved reflections yet."),
  ).toBeVisible();
}

test.describe("a reflection whose entry changes", () => {
  // Editing the entry removes the reflection built from it (PRD AC-12)
  // and asks AI for nothing (AC-03).
  test("is removed when the entry is edited: warned before, told after, and nothing is sent", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntryAndAsk(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });

    // Follow the citation to the entry, and edit it.
    await page
      .getByRole("link", { name: /^Source 1: your entry from/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await expect(
      page.getByText(
        "1 reflection was built from this entry. It will be removed if you change the words of your answers",
      ),
    ).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel(PROMPTS[0] ?? "").fill("We cooked lunch together.");
    await page.getByRole("button", { name: /^Save/ }).click();

    const notice = page.getByRole("status").filter({ hasText: REMOVED });
    await expect(notice).toBeVisible();
    await expectNoViolations(page);
    await expectNoReflections(page);
    // Nothing was asked of any provider, and nothing left the browser.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(requests).toEqual([]);

    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText(REMOVED)).toHaveCount(0);
  });

  // Deleting the entry removes the reflection built from it (PRD AC-12).
  test("is removed when the entry is deleted, after the confirmation says so", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntryAndAsk(page);

    await page
      .getByRole("link", { name: /^Source 1: your entry from/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Delete this entry" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "1 reflection was built from this entry. It will be removed when you delete it",
    );
    await dialog.getByRole("button", { name: "Delete entry" }).click();

    await expect(page.getByText(REMOVED)).toBeVisible();
    await expectNoReflections(page);
  });
});
