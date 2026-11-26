/**
 * A journal too long to send whole, in the browser (PRD RF-004, AI-016;
 * AC-09; ADR-0009). The stand-in provider accepts little, so a handful of
 * long entries is already too much.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard } from "./account";

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

async function writeEntry(page: Page, good: string): Promise<void> {
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await page.getByRole("link", { name: "Write a new entry" }).click();
  await page.getByLabel(PROMPTS[0] ?? "").fill(good);
  await page.getByLabel(PROMPTS[1] ?? "").fill("Synthetic second answer.");
  await page.getByLabel(PROMPTS[2] ?? "").fill("Synthetic third answer.");
  await page.getByRole("button", { name: "Save entry" }).click();
  await expect(page.getByText("A journal entry.")).toBeVisible();
  await page.getByRole("link", { name: "Warmly home" }).click();
}

async function askAbout(page: Page, question: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Reflect" })
    .click();
  await page.getByRole("link", { name: "Ask a question" }).click();
  await page
    .getByLabel("What would you like to ask about your journal?")
    .fill(question);
  await page.getByRole("button", { name: "Ask" }).click();
}

test.describe("Reflect with a long journal", () => {
  test("says how many entries will be sent before sending, and how many the answer is about", async ({
    page,
  }) => {
    await onboard(page);
    for (let number = 1; number <= 5; number += 1) {
      await writeEntry(
        page,
        `Synthetic long entry ${String(number)}. ${"We talked it through. ".repeat(270)}`,
      );
    }

    await askAbout(page, "What has gone well?");

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "This sends 3 of your 5 journal entries and your question to Test provider",
    );
    await expect(dialog).toContainText(
      "Your whole journal does not fit in one request.",
    );
    await expectNoViolations(page);

    await dialog.getByRole("button", { name: "Send to Test provider" }).click();

    await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible();
    await expect(
      page.getByText(
        "This answer is about 3 of the 5 journal entries you had when you asked.",
      ),
    ).toBeVisible();
    await expectNoViolations(page);

    // It is stored with the answer: still said after leaving and coming back.
    await page.getByRole("link", { name: "Warmly home" }).click();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Reflect" })
      .click();
    await page
      .getByRole("navigation", { name: "Your reflections" })
      .getByRole("link")
      .click();
    await expect(
      page.getByText(
        "This answer is about 3 of the 5 journal entries you had when you asked.",
      ),
    ).toBeVisible();
  });

  test("leaves out an entry that is too long, says so, and answers from the rest", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "We cooked dinner together on Sunday.");
    await writeEntry(page, "Synthetic very long entry. ".repeat(1200));

    await askAbout(page, "What has gone well?");

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "This sends 1 of your 2 journal entries and your question to Test provider",
    );
    await expect(dialog).toContainText(
      "1 entry is too long to send in one request, so it is left out.",
    );
    await expectNoViolations(page);
    await dialog.getByRole("button", { name: "Send to Test provider" }).click();

    await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible();
    await expect(
      page.getByText(
        "This answer is about 1 of the 2 journal entries you had when you asked.",
      ),
    ).toBeVisible();
  });

  test("sends nothing and points to the entry when no entry at all can be sent", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "Synthetic very long entry. ".repeat(1200));

    await askAbout(page, "What has gone well?");

    const alert = page.getByRole("alert").filter({ hasText: "too long" });
    await expect(alert).toContainText(
      "is too long to send in one request, and no other entry can be sent either, so nothing was sent.",
    );
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(
      page.getByLabel("What would you like to ask about your journal?"),
    ).toHaveValue("What has gone well?");
    await expectNoViolations(page);

    await alert.getByRole("link", { name: "Open that entry" }).click();
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
  });
});
