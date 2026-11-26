/**
 * Writing after a conversation, in the browser (PRD PC-001 to PC-004;
 * AC-03, AC-23).
 *
 * It is always the person's own choice: nothing asks for it when
 * presentation closes. What is written is its own kind of thing, listed
 * under its own label, found by search, kept through a lock and a reload,
 * and named as itself when Reflect is asked about it.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard, unlockThisDevice } from "./account";

const QUESTIONS = [
  "What went well?",
  "What felt difficult or unresolved?",
  "What would you like to remember?",
];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

function listed(page: Page) {
  return page
    .getByRole("navigation", { name: "Entries" })
    .getByRole("link", { name: /^After a conversation: / });
}

test.describe("writing after a conversation", () => {
  test("closing presentation asks for nothing (PC-002)", async ({ page }) => {
    await onboard(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Prepare for a Conversation" })
      .click();
    await page.getByLabel("Name").fill("Sunday talk");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page.getByRole("link", { name: /Sunday talk/ }).click();
    await page
      .getByLabel("What do you want to say?")
      .fill("Thank you for Thursday.");
    await page.getByRole("button", { name: "Add card" }).click();
    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(page.getByText("Card 1 of 1")).toBeVisible();

    await page
      .getByRole("link", { name: "Close and go back to the collection" })
      .click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sunday talk",
    );
    // No prompt, no dialog, no reminder and no mark anywhere on the page.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/after a conversation/i)).toHaveCount(0);
    await expect(page.getByText(/how did it go/i)).toHaveCount(0);
    for (const question of QUESTIONS) {
      await expect(page.getByText(question)).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Warmly home" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await expect(page.getByText(/after a conversation/i)).toHaveCount(0);
  });

  test("chosen from the journal, written, found again, and asked about", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page
      .getByRole("link", { name: "Write about a conversation you had" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "After a conversation",
    );
    for (const question of QUESTIONS) {
      await expect(page.getByLabel(question)).toHaveValue("");
    }
    await expectNoViolations(page);

    // Nothing written: nothing saved, and the page says why.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Write something in at least one of the three boxes"),
    ).toBeVisible();

    // One answer is enough.
    await page
      .getByLabel("What went well?")
      .fill("CANARY we both stayed calm in the kitchen.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save changes" }),
    ).toBeVisible();
    // The address holds an ID, never the words.
    expect(page.url()).toMatch(/\/journal\/after-conversation\/[0-9a-f-]{36}$/);
    await expectNoViolations(page);

    // In the journal it has its own label, and search finds it.
    await page.getByRole("link", { name: "Back to your journal" }).click();
    await expect(listed(page)).toHaveCount(1);
    await page.getByLabel("Search your journal").fill("kitchen");
    await expect(listed(page)).toHaveCount(1);
    await page.getByLabel("Search your journal").fill("no such words");
    await expect(listed(page)).toHaveCount(0);
    await expectNoViolations(page);

    // It is kept, encrypted, through a lock and a reload.
    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page.getByText("CANARY")).toHaveCount(0);
    await page.reload();
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(listed(page)).toHaveCount(1);

    // Reflect is told what it is, before anything is sent, and cites it
    // as what it is.
    await page.getByRole("link", { name: "Warmly home" }).click();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Reflect" })
      .click();
    await page.getByRole("link", { name: "Ask a question" }).click();
    await page
      .getByLabel("What would you like to ask about your journal?")
      .fill("What helped?");
    await page.getByRole("button", { name: "Ask" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "1 note written after a conversation and your question",
    );
    await dialog.getByRole("button", { name: "Send to Test provider" }).click();
    const answer = page.locator(".card", { hasText: "Answer" }).last();
    await expect(
      answer.getByRole("region", {
        name: "Where this comes from in your journal",
      }),
    ).toContainText("What you wrote after a conversation on");
    await expectNoViolations(page);

    // Following the citation opens its own screen, with the words there.
    await answer
      .getByRole("link", { name: /What you wrote after a conversation on/ })
      .first()
      .click();
    await expect(page.getByLabel("What went well?")).toHaveValue(
      "CANARY we both stayed calm in the kitchen.",
    );
    await expect(
      page.getByText(/1 reflection was built in Reflect from what you wrote/),
    ).toBeVisible();
  });
});
