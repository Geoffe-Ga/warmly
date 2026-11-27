/**
 * Reflect in the browser, against the stand-in provider (PRD RF-001,
 * RF-002, RF-003, RF-005; AC-03, AC-07, AC-23).
 *
 * The stand-in sends nothing: the fixture fails any test that contacts
 * another host. Sessions are held in memory for now.
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

test.describe("Reflect", () => {
  // Opening Reflect and searching ask AI for nothing (PRD AC-03). The
  // question goes only after agreeing, and the answer cites the entry
  // (AC-07). The screens pass axe; a citation opens by keyboard (AC-23).
  test("opening Reflect asks nothing; a question is sent only after agreeing; a citation opens the entry", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "We cooked dinner together on Sunday.");
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });
    const h1 = page.getByRole("heading", { level: 1 });

    // The landing page: nothing is asked by opening it or by searching.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Reflect" })
      .click();
    await expect(h1).toHaveText("Reflect");
    await expect(
      page.getByText("You have no saved reflections yet."),
    ).toBeVisible();
    await page.getByLabel("Search your journal").fill("cooked");
    await expect(
      page.getByRole("navigation", { name: "Entries" }).getByRole("link"),
    ).toHaveCount(1);
    await expectNoViolations(page);

    // A new reflection: the person's own question.
    await page.getByRole("link", { name: "Ask a question" }).click();
    await expect(h1).toHaveText("Reflection");
    const box = page.getByLabel(
      "What would you like to ask about your journal?",
    );
    await expect(box).toHaveValue("");
    await box.fill("What has gone well lately?");
    await page.getByRole("button", { name: "Ask" }).click();

    // The disclosure comes first, and Don't send keeps the question.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("1 journal entry and your question");
    await dialog.getByRole("button", { name: "Don't send" }).click();
    await expect(box).toHaveValue("What has gone well lately?");
    await expect(page.getByRole("heading", { name: "Answer" })).toHaveCount(0);

    // Ask again and agree.
    await page.getByRole("button", { name: "Ask" }).click();
    await dialog.getByRole("button", { name: "Send to Test provider" }).click();
    const answer = page.locator(".card", { hasText: "Answer" }).last();
    await expect(answer).toContainText("A test answer about 1 entries.");
    await expect(page.getByText("What has gone well lately?")).toBeVisible();
    // The address holds an ID, never the question.
    expect(page.url()).toMatch(/\/reflect\/sessions\/[0-9a-f-]{36}$/);
    await expect(
      answer.getByRole("region", {
        name: "Where this comes from in your journal",
      }),
    ).toContainText("We cooked dinner together on Sunday.");
    await expectNoViolations(page);

    // Nothing left the browser at any point.
    expect(requests).toEqual([]);

    // A citation is reachable from the keyboard and opens the entry.
    const citation = answer.getByRole("link", {
      name: /^Source 1: your entry from/,
    });
    await citation.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("link", { name: "Edit this entry" }),
    ).toBeVisible();
    await expect(
      page.getByText("We cooked dinner together on Sunday."),
    ).toBeVisible();
    // The cited words are marked, and nothing about them is in the address.
    await expect(
      page.getByText("The words it pointed to are marked below."),
    ).toBeVisible();
    const mark = page.locator("mark.cited-passage");
    await expect(mark).toHaveCount(1);
    await expect(mark).toContainText("We cooked dinner together on Sunday.");
    await expect(mark).toBeInViewport();
    expect(new URL(page.url()).search).toBe("");
    expect(new URL(page.url()).hash).toBe("");
    await expectNoViolations(page);

    // Back on the landing page the reflection is listed, and opening it
    // shows the saved answer without asking anything again.
    await page.getByRole("link", { name: "Warmly home" }).click();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Reflect" })
      .click();
    const saved = page
      .getByRole("navigation", { name: "Your reflections" })
      .getByRole("link");
    await expect(saved).toHaveCount(1);
    await expect(saved).toContainText("What has gone well lately?");
    await saved.click();
    await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(requests).toEqual([]);

    // A follow-up says that this reflection's earlier turns go with it,
    // and is answered in the same reflection.
    await page
      .getByLabel("What would you like to ask about your journal?")
      .fill("And what was hard?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(dialog).toContainText(
      "1 journal entry, your question, and the earlier questions and answers in this reflection",
    );
    await dialog.getByRole("button", { name: "Send to Test provider" }).click();
    await expect(page.getByRole("heading", { name: "Answer" })).toHaveCount(2);
    await expect(
      page.locator(".card", { hasText: "Answer" }).last(),
    ).toContainText("after 1 earlier in this reflection");
    expect(requests).toEqual([]);
  });
});
