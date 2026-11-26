/**
 * Presentation in the browser (PRD CC-012; AC-14, AC-03).
 *
 * One card at a time, always starting at the first, with nothing kept
 * about what was shown: no request, no stored value, no history entry.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard } from "./account";

const CARDS = [
  "Thank you for Thursday.",
  "Could we plan the weekend on Friday?",
  "What would make evenings easier for you?",
];

async function collectionWithThreeCards(page: Page): Promise<void> {
  await onboard(page);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Prepare for a Conversation" })
    .click();
  await page.getByLabel("Name").fill("Sunday talk");
  await page.getByRole("button", { name: "Create collection" }).click();
  await page.getByRole("link", { name: /Sunday talk/ }).click();
  for (const text of CARDS) {
    await page.getByLabel("What do you want to say?").fill(text);
    await page.getByRole("button", { name: "Add card" }).click();
    await expect(page.getByLabel("What do you want to say?")).toHaveValue("");
  }
  // Let the cards reach the in-page server before anything is counted.
  await expect(page.locator(".sync-status [role=status]")).toHaveText(
    "All changes saved",
  );
}

/** What the browser holds that could record a viewing. */
async function traces(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify({
      url: window.location.href,
      session: { ...sessionStorage },
      local: { ...localStorage },
      historyLength: window.history.length,
      historyState: window.history.state as unknown,
      cookie: document.cookie,
    }),
  );
}

test.describe("presentation", () => {
  test("advance to card three, close, reopen: card one, and nothing was recorded or sent (AC-14)", async ({
    page,
  }) => {
    await collectionWithThreeCards(page);
    const card = page.locator(".present-card");

    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(page.getByText("Card 1 of 3")).toBeVisible();
    await expect(card).toHaveText(CARDS[0] ?? "");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);

    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });
    const before = await traces(page);

    // Forward with the button (a tap on a phone), then with the keyboard.
    await page.getByRole("button", { name: "Next card" }).click();
    await expect(page.getByText("Card 2 of 3")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Card 3 of 3")).toBeVisible();
    await expect(card).toHaveText(CARDS[2] ?? "");
    await expect(
      page.getByRole("button", { name: "Next card" }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("Card 2 of 3")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Card 3 of 3")).toBeVisible();

    // Nothing in the address, storage or history changed, and nothing
    // was requested.
    expect(await traces(page)).toBe(before);
    expect(requests).toEqual([]);

    // Close: back to the collection, and nothing else starts.
    await page
      .getByRole("link", { name: "Close and go back to the collection" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sunday talk",
    );
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Reopen: card one again.
    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(page.getByText("Card 1 of 3")).toBeVisible();
    await expect(card).toHaveText(CARDS[0] ?? "");
    expect(requests).toEqual([]);
  });

  test("the card text grows with the reader's text size and stays on the page", async ({
    page,
  }) => {
    await collectionWithThreeCards(page);
    await page.getByRole("link", { name: "Present these cards" }).click();
    const card = page.locator(".present-card");
    await expect(card).toBeVisible();
    const size = (): Promise<number> =>
      card.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      );
    const normal = await size();

    // As a person who has set a larger default text size would see it.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    expect(await size()).toBeCloseTo(normal * 2, 0);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Next card" })).toBeVisible();
  });
});
