/**
 * The disclosure shown before anything goes to an AI provider, and the
 * provider's state in Settings (PRD SEC-009, AI-001, AI-015; AC-23).
 *
 * No real provider exists in any test: the `e2e` build has only the
 * stand-in, which sends nothing, and the fixture fails any test that
 * contacts another host.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/test";

import { onboard } from "./account";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("the AI disclosure", () => {
  test("says what is sent and to whom, defaults to not sending, and is accessible", async ({
    page,
  }) => {
    await page.goto("/dev/components");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Component gallery",
    );
    const opener = page.getByRole("button", { name: "Ask before sending" });
    await opener.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText(
      "Send this to Test provider?",
    );
    await expect(dialog).toContainText("14 journal entries and your question");
    await expect(dialog).toContainText("Test provider is a separate company");
    await expect(dialog).toContainText(
      "does not mean Test provider keeps nothing",
    );
    await expect(dialog).toContainText(/large request \(about [\d,]+ tokens\)/);
    await expect(
      dialog.getByRole("button", { name: "Don't send" }),
    ).toBeFocused();
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA)
      .analyze();
    expect(results.violations).toEqual([]);

    // Escape sends nothing and gives focus back.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Nothing was sent.")).toBeVisible();
    await expect(opener).toBeFocused();

    // Sending takes a deliberate second step, with the keyboard alone.
    await opener.click();
    await expect(
      dialog.getByRole("button", { name: "Don't send" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Send to Test provider" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("You chose to send.")).toBeVisible();
  });

  test("Settings says which provider is connected, and opening it sends nothing", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Settings" }).click();

    // The status summary names the provider too; this is the card headed
    // "AI provider".
    const card = page.locator(".card", {
      has: page.getByRole("heading", { name: "AI provider" }),
    });
    await expect(card).toContainText("Connected: Test provider");
    await expect(card).toContainText("it sends nothing anywhere");
    await expect(card).toContainText("only ever happens when you ask");
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA)
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
