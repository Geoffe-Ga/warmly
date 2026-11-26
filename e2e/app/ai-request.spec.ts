/**
 * The states of an AI request in the browser (PRD AI-014 to AI-017,
 * SEC-009; AC-15).
 *
 * The component gallery drives the real controller, dialog and status
 * component with a stand-in that sends nothing: the fixture fails any test
 * that contacts another host.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

const SEND = "Send to Test provider";

test.describe("an AI request", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/components");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Component gallery",
    );
  });

  test("asks first, then answers", async ({ page }) => {
    const sample = page.locator(".card", { hasText: "AI request" }).last();
    await expect(sample.getByText("No answer yet.")).toBeVisible();

    await sample.getByRole("button", { name: "Ask and get an answer" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("1 journal entry and your question");
    await expect(sample.getByText("No answer yet.")).toBeVisible();

    await dialog.getByRole("button", { name: SEND }).click();
    await expect(sample.getByText("An answer came back.")).toBeVisible();
    await expect(sample.getByRole("alert")).toHaveCount(0);
  });

  test("a failure says what happened and waits for the person; Try again asks again", async ({
    page,
  }) => {
    const sample = page.locator(".card", { hasText: "AI request" }).last();
    await sample.getByRole("button", { name: "Ask and fail" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: SEND }).click();

    const alert = sample.getByRole("alert");
    await expect(alert).toContainText("Test provider is limiting");
    await expect(alert).toContainText("Nothing you wrote or chose was lost.");
    await expect(alert).toContainText("you will be asked first");
    await expectNoViolations(page);

    // Nothing happens by itself.
    await page.waitForTimeout(1500);
    await expect(alert).toBeVisible();
    await expect(dialog).toBeHidden();

    // Try again, from the keyboard: the dialog is back, and it starts on
    // the choice that sends nothing.
    await alert.getByRole("button", { name: "Try again" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Don't send" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(sample.getByRole("alert")).toHaveCount(0);
  });

  test("a request that is taking a while can be cancelled, with no error", async ({
    page,
  }) => {
    const sample = page.locator(".card", { hasText: "AI request" }).last();
    await sample.getByRole("button", { name: "Ask and wait" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: SEND })
      .click();

    await expect(
      sample.getByText("Waiting for Test provider to answer."),
    ).toBeVisible();
    await expectNoViolations(page);

    await sample.getByRole("button", { name: "Cancel" }).click();

    await expect(
      sample.getByText("Waiting for Test provider to answer."),
    ).toBeHidden();
    await expect(sample.getByRole("alert")).toHaveCount(0);
    await expect(sample.getByText("No answer yet.")).toBeVisible();
  });
});
