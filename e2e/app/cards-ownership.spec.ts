/**
 * Making an AI-drafted card your own, in the browser (PRD CC-006 to
 * CC-009, DEP-003; AC-03, AC-12, AC-23; decision D-15).
 *
 * A card the person has changed is kept when its source entry changes; a
 * card nobody changed is removed. Nothing here calls AI after the cards
 * are drafted: the fixture fails any test that contacts another host, and
 * the test counts requests as well.
 *
 * This is one browser. The same thing across two devices against a real
 * backend belongs to the release tests (#63).
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

test.describe("a card the person has made their own", () => {
  // Changing a drafted card makes it the person's; when a source entry is
  // edited the unedited card goes and theirs stays (PRD AC-12). Editing
  // the card and the entry asks AI for nothing (AC-03). The card screen
  // is checked with axe (AC-23).
  test("is kept when its source entry changes, while an unedited AI card is removed", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "Alpha: we cooked dinner together.");
    await writeEntry(page, "Bravo: a quiet walk by the river.");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Prepare for a Conversation" })
      .click();
    await page.getByLabel("Name").fill("Sunday talk");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page.getByRole("link", { name: /Sunday talk/ }).click();
    await page
      .getByRole("link", { name: "Pick entries and suggest cards" })
      .click();
    await page.getByRole("checkbox", { name: /Alpha/ }).check();
    await page.getByRole("checkbox", { name: /Bravo/ }).check();
    await page.getByRole("button", { name: "Suggest cards" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Send to Test provider" })
      .click();
    await expect(page.getByText("2 cards were drafted")).toBeVisible();
    await page.getByRole("link", { name: "Back to the collection" }).click();
    await expect(cardRows(page)).toHaveCount(2);
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });

    // Rewrite the first card. The page says what saving will do.
    await cardRows(page).first().click();
    await expect(
      page.getByText("Saving any change makes this card yours."),
    ).toBeVisible();
    await expectNoViolations(page);
    const box = page.getByLabel("What do you want to say?");
    await expect(box).toHaveValue("A test card.");
    await box.fill("Thank you for cooking with me. I'd love to do it again.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Written by you.")).toBeVisible();
    await expect(page.locator(".card-reading").first()).toHaveText(
      "Thank you for cooking with me. I'd love to do it again.",
    );
    // Nothing of the AI's is left on it, so there is no learning mode.
    await expect(page.getByRole("radio", { name: /^Learning/ })).toHaveCount(0);
    await expectNoViolations(page);

    // In the collection it is no longer marked as drafted by AI.
    await page.getByRole("link", { name: "Back to the collection" }).click();
    await expect(cardRows(page).first()).not.toContainText("Drafted by AI");
    await expect(cardRows(page).last()).toContainText("Drafted by AI");

    // Edit a source entry. Only the card nobody changed is warned about.
    await page.getByRole("link", { name: "Warmly home" }).click();
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Entries" })
      .getByRole("link")
      .last()
      .click();
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await expect(
      page.getByText("1 card drafted by AI was built from this entry."),
    ).toBeVisible();
    await page.getByLabel(PROMPTS[0] ?? "").fill("Alpha, rewritten.");
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "A card drafted by AI was removed" }),
    ).toBeVisible();

    // The person's card is still there, word for word.
    await openCollection(page);
    await expect(cardRows(page)).toHaveCount(1);
    await expect(cardRows(page).first()).toContainText(
      "Thank you for cooking with me. I'd love to do it again.",
    );
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(requests).toEqual([]);
  });
});
