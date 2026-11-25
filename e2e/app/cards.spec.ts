/**
 * The Prepare flow in the browser, against invented in-memory cards (PRD
 * CC-001, CC-007, CC-012, CC-013; AC-23).
 *
 * Nothing here is saved yet and nothing calls AI: the fixture fails any
 * test that contacts another host.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard } from "./account";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

const FIRST =
  "I loved cooking with you on Sunday. It made me feel close to you.";

test.describe("preparing for a conversation", () => {
  test("from Home to a collection, a card, the presentation and the print view", async ({
    page,
  }) => {
    await onboard(page);
    const h1 = page.getByRole("heading", { level: 1 });

    // Home to the collections.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Prepare for a Conversation" })
      .click();
    await expect(h1).toHaveText("Prepare for a Conversation");
    const collections = page.getByRole("navigation", {
      name: "Your collections",
    });
    await expect(collections.getByRole("link")).toHaveCount(3);
    await expectNoViolations(page);

    // A collection: its name is the heading, never the address or the tab.
    await collections.getByRole("link", { name: /Sunday talk/ }).click();
    await expect(h1).toHaveText("Sunday talk");
    expect(page.url()).not.toMatch(/sunday/i);
    expect(await page.title()).not.toMatch(/sunday/i);
    const cards = page.getByRole("navigation", {
      name: "Cards in this collection",
    });
    await expect(cards.getByRole("link")).toHaveCount(3);
    await expectNoViolations(page);

    // A card.
    await cards.getByRole("link").first().click();
    await expect(h1).toHaveText("Card");
    await expect(page.getByText(FIRST)).toBeVisible();
    await expect(
      page.getByText(
        "Drafted by AI from your journal. You can rewrite all of it.",
      ),
    ).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("link", { name: "Back to the collection" }).click();

    // Presentation: opens at card one, one card at a time.
    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(h1).toHaveText("Presentation");
    await expect(page.getByText("Card 1 of 3")).toBeVisible();
    await expect(page.locator(".present-card")).toHaveText(FIRST);
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Next card" }).click();
    await expect(page.getByText("Card 2 of 3")).toBeVisible();
    await expect(page.locator(".present-card")).not.toHaveText(FIRST);

    // Leaving and coming back starts at card one again (CC-012).
    await page.getByRole("link", { name: "Back to the collection" }).click();
    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(page.getByText("Card 1 of 3")).toBeVisible();
    await page.getByRole("link", { name: "Back to the collection" }).click();

    // Print: the card text only.
    await page.getByRole("link", { name: "Print these cards" }).click();
    await expect(h1).toHaveText("Print");
    const sheet = page.getByRole("region", { name: "What will be printed" });
    await expect(sheet.getByRole("listitem")).toHaveCount(3);
    await expect(sheet).not.toContainText("Drafted by AI");
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("presentation works from the keyboard", async ({ page }) => {
    await onboard(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Prepare for a Conversation" })
      .click();
    await page.getByRole("link", { name: /Sunday talk/ }).click();
    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(page.getByText("Card 1 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Next card" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Card 2 of 3")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Card 3 of 3")).toBeVisible();
    // The button that now leads nowhere keeps focus and does nothing.
    await expect(page.getByRole("button", { name: "Next card" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Card 3 of 3")).toBeVisible();
  });
});
