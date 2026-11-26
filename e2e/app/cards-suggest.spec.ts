/**
 * Asking AI to draft cards from picked entries, in the browser, against
 * the stand-in provider (PRD CC-001 to CC-004, DEP-003; AC-03, AC-10,
 * AC-12, AC-15, AC-23).
 *
 * The stand-in sends nothing: the fixture fails any test that contacts
 * another host.
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

async function openCollection(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Warmly home" }).click();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Prepare for a Conversation" })
    .click();
  await page.getByRole("link", { name: /Sunday talk/ }).click();
}

function cardRows(page: Page) {
  return page
    .getByRole("navigation", { name: "Cards in this collection" })
    .getByRole("link");
}

test.describe("cards drafted by AI", () => {
  test("pick two of three entries, agree, and two cards appear; editing a picked entry removes them", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "Alpha: we cooked dinner together.");
    await writeEntry(page, "Bravo: a quiet walk by the river.");
    await writeEntry(page, "Charlie: we talked about money calmly.");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Prepare for a Conversation" })
      .click();
    await page.getByLabel("Name").fill("Sunday talk");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page.getByRole("link", { name: /Sunday talk/ }).click();
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });

    // The picker: nothing is ticked, and the button is not available.
    await page
      .getByRole("link", { name: "Pick entries and suggest cards" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Suggest cards",
    );
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(3);
    for (const box of await boxes.all()) {
      await expect(box).not.toBeChecked();
    }
    const suggest = page.getByRole("button", { name: "Suggest cards" });
    await expect(suggest).toHaveAttribute("aria-disabled", "true");
    await expectNoViolations(page);

    // Tick two with the keyboard and the pointer.
    await page.getByRole("checkbox", { name: /Alpha/ }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("checkbox", { name: /Charlie/ }).check();
    await expect(page.getByText("2 entries ticked.")).toBeVisible();
    await suggest.click();

    // The disclosure says exactly what goes; Don't send keeps the ticks.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "This sends 2 journal entries to Test provider",
    );
    await expectNoViolations(page);
    await dialog.getByRole("button", { name: "Don't send" }).click();
    await expect(page.getByRole("checkbox", { name: /Alpha/ })).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /Bravo/ }),
    ).not.toBeChecked();

    // Agree: two cards, one for each picked entry, and none for the other.
    await suggest.click();
    await dialog.getByRole("button", { name: "Send to Test provider" }).click();
    await expect(
      page.getByText("2 cards were drafted and added to the end"),
    ).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("link", { name: "Back to the collection" }).click();
    await expect(cardRows(page)).toHaveCount(2);
    await expect(cardRows(page).first()).toContainText("Drafted by AI");
    await expectNoViolations(page);

    // One card, opened: it says what it is, and can be deleted.
    await cardRows(page).first().click();
    await expect(
      page.getByText("Drafted by AI from journal entries you picked."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete this card" }),
    ).toBeVisible();
    await expectNoViolations(page);
    // Nothing left the browser at any point.
    expect(requests).toEqual([]);

    // Editing a picked entry: warned before, and the cards go after.
    await page.getByRole("link", { name: "Warmly home" }).click();
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Entries" })
      .getByRole("link")
      .last()
      .click();
    await expect(
      page.getByText("Alpha: we cooked dinner together."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await expect(
      page.getByText(
        "2 cards drafted by AI were built from this entry. They will be removed if you change the words of your answers",
      ),
    ).toBeVisible();
    await page.getByLabel(PROMPTS[0] ?? "").fill("Alpha, rewritten.");
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "2 cards drafted by AI were removed" }),
    ).toBeVisible();
    await openCollection(page);
    await expect(
      page.getByText("This collection has no cards yet."),
    ).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(requests).toEqual([]);
  });
});
