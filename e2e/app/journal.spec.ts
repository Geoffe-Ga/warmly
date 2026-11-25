/**
 * The journal flow in the browser (PRD JR-001; AC-23).
 *
 * The `e2e` build's journal is held in memory and starts with two synthetic
 * example entries. Nothing here is saved for good yet, and nothing calls AI:
 * the fixture fails any test that contacts another host.
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

function entries(page: Page) {
  return page.getByRole("navigation", { name: "Entries" }).getByRole("link");
}

test.describe("the journal", () => {
  test("from Home to the journal, a new entry, the timeline, the entry and back", async ({
    page,
  }) => {
    await onboard(page);

    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Journal");
    await expect(entries(page)).toHaveCount(2);
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Write a new entry" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "New journal entry",
    );
    const boxes = page.getByRole("textbox");
    await expect(boxes).toHaveCount(3);
    for (const [index, prompt] of PROMPTS.entries()) {
      await expect(page.getByLabel(prompt)).toBeVisible();
      await page
        .getByLabel(prompt)
        .fill(`Synthetic answer ${String(index + 1)}`);
    }
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Save entry" }).click();

    // The new entry opens, with each answer under its question.
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    for (const [index, prompt] of PROMPTS.entries()) {
      const section = page
        .locator("section.card")
        .filter({ has: page.getByRole("heading", { level: 2, name: prompt }) });
      await expect(
        section.getByText(`Synthetic answer ${String(index + 1)}`),
      ).toBeVisible();
    }
    await expectNoViolations(page);

    // Back in the timeline it is listed first, and search finds it.
    await page.getByRole("link", { name: "Back to your journal" }).click();
    await expect(entries(page)).toHaveCount(3);
    await page.getByLabel("Search your journal").fill("SYNTHETIC ANSWER 2");
    await expect(entries(page)).toHaveCount(1);
    await expect(page).toHaveURL(/\/journal$/);
    await expectNoViolations(page);
    await entries(page).first().click();
    await expect(page.getByText("Synthetic answer 3")).toBeVisible();

    await page.getByRole("link", { name: "Warmly" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });

  test("what was written is gone after a lock, and never touched web storage", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    await page.getByLabel(PROMPTS[0] ?? "").fill("Synthetic private sentence");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("Synthetic private sentence")).toBeVisible();

    const stored = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    expect(stored).not.toContain("Synthetic private sentence");

    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(page.getByText("Synthetic private sentence")).toHaveCount(0);
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();

    await expect(entries(page)).toHaveCount(2);
    await expect(
      page.getByText("Entries are kept only until Warmly locks"),
    ).toBeVisible();
  });

  test("an entry that is not on this device says so", async ({ page }) => {
    await onboard(page);
    await page.evaluate(() => {
      window.history.pushState(
        null,
        "",
        "/journal/entries/00000000-0000-4000-8000-0000000000ff",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await expect(
      page.getByText("This entry isn't on this device."),
    ).toBeVisible();
    await expectNoViolations(page);
  });
});
