/**
 * Learning mode and conversation mode for a card AI drafted, in the
 * browser (PRD CC-004 to CC-006; AC-03, AC-11, AC-23).
 *
 * Every part is opened from the keyboard. Looking at a card calls no AI.
 * Other wordings for a part are asked for only by pressing its button and
 * agreeing in the dialog (CC-005; AC-15). The stand-in provider sends
 * nothing: the fixture fails any test that contacts another host, and the
 * test counts requests as well.
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

test.describe("a card AI drafted, in two modes", () => {
  test("conversation mode is the plain words; learning mode opens each part by keyboard and shows the person's own words", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "We cooked dinner together on Sunday.");
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
    await page.getByRole("checkbox", { name: /cooked dinner/ }).check();
    await page.getByRole("button", { name: "Suggest cards" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Send to Test provider" })
      .click();
    await expect(page.getByText("1 card was drafted")).toBeVisible();
    await page.getByRole("link", { name: "Back to the collection" }).click();
    await page
      .getByRole("navigation", { name: "Cards in this collection" })
      .getByRole("link")
      .first()
      .click();
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });

    // Conversation mode first: the words, and nothing about them.
    await expect(page.locator(".card-reading")).toHaveText("A test card.");
    await expect(
      page.getByRole("radio", { name: /^Conversation/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("list", { name: "The parts of this card" }),
    ).toHaveCount(0);
    await expect(page.getByText("A test explanation.")).toHaveCount(0);
    await expectNoViolations(page);

    // Learning mode, picked from the keyboard.
    await page.getByRole("radio", { name: /^Conversation/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /^Learning/ })).toBeChecked();
    const part = page.getByRole("button", {
      name: "Appreciation A test card.",
    });
    await expect(part).toHaveAttribute("aria-expanded", "false");
    await expectNoViolations(page);

    // Open the part with Enter: focus goes into the panel.
    await part.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: "About this part" });
    await expect(panel).toBeVisible();
    await expect(part).toHaveAttribute("aria-expanded", "true");
    await expect(
      panel.getByRole("heading", { name: "About this part" }),
    ).toBeFocused();
    // The person's own words, read from the entry as it is now.
    await expect(panel.getByTestId("source-excerpt")).toHaveText(
      "We cooked dinner together on Sunday.",
    );
    await expect(panel).toContainText("A test explanation.");
    await expect(panel).toContainText(
      "It does not make a claim about what happened true",
    );
    await expect(
      panel.getByRole("button", { name: "Generate more options" }),
    ).toBeVisible();
    await expectNoViolations(page);

    // Escape closes it and gives focus back to the part.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(part).toBeFocused();

    // Space opens it too, and Close gives focus back.
    await page.keyboard.press("Space");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(part).toBeFocused();

    // None of this asked anything of a provider or left the browser.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(requests).toEqual([]);

    // Other wordings: asked for only by pressing the button, and only
    // after agreeing to what would be sent.
    await page.keyboard.press("Enter");
    await panel.getByRole("button", { name: "Generate more options" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "This sends 1 journal entry and the wording you chose to Test provider",
    );
    await expectNoViolations(page);
    await dialog.getByRole("button", { name: "Send to Test provider" }).click();
    const options = panel.getByRole("region", {
      name: "Other ways to say this part",
    });
    await expect(options).toContainText("These are AI suggestions.");
    await expect(options).toContainText("A test alternative.");
    await expect(options).toContainText("Another test alternative.");
    await expectNoViolations(page);
    // Nothing is stored until one is picked: the card's words are as before.
    await expect(page.locator(".card-reading").first()).toHaveText(
      "A test card.",
    );

    await options
      .getByRole("button", {
        name: "Use this wording: Another test alternative.",
      })
      .click();
    await expect(page.locator(".card-reading").first()).toHaveText(
      "Another test alternative.",
    );
    // Picking it made the card the person's own. The panel stays where it
    // was and says what happened.
    await expect(panel).toContainText("These are your own words.");
    await expect(panel).toContainText(
      "This part now uses the wording you picked. Choosing it makes this card yours.",
    );
    await expect(page.getByText("Written by you.")).toBeVisible();
    await expect(panel.getByTestId("source-excerpt")).toHaveCount(0);
    await expect(options).toHaveCount(0);
    await expectNoViolations(page);
    expect(requests).toEqual([]);
  });
});
