/**
 * Printing a collection (PRD CC-013; AC-13).
 *
 * With the browser set to print media, the page shows what paper would:
 * the collection's name and the cards' words, and nothing else.
 */
import { expect, test, type Page } from "../fixtures/test";

import { onboard } from "./account";

const CARDS = [
  "When plans change late, I feel unsettled.",
  "Could we agree the weekend plan by Thursday?",
  "Thank you for cooking on Sunday.",
];

async function onThePrintScreen(page: Page): Promise<void> {
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
    await page.getByRole("radio", { name: "Need and request" }).check();
    await page.getByRole("button", { name: "Add card" }).click();
    await expect(page.getByLabel("What do you want to say?")).toHaveValue("");
  }
  await expect(page.locator(".sync-status [role=status]")).toHaveText(
    "All changes saved",
  );
  await page.getByRole("link", { name: "Print these cards" }).click();
  await expect(
    page.getByRole("region", { name: "What will be printed" }),
  ).toBeVisible();
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

test.describe("printing a collection", () => {
  test("printed output holds card text only (CC-013)", async ({ page }) => {
    await onThePrintScreen(page);

    // On screen there is more than the sheet: the note and the button.
    await expect(page.getByText(/not protected by Warmly/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();

    await page.emulateMedia({ media: "print" });

    // What paper would show: exactly the name and the cards, in order.
    expect(lines(await page.locator("body").innerText())).toEqual([
      "Sunday talk",
      ...CARDS,
    ]);
    for (const hidden of [
      page.getByRole("button", { name: "Print" }),
      page.getByRole("button", { name: "Lock" }),
      page.getByRole("button", { name: "Menu" }),
      page.getByRole("heading", { level: 1 }),
      page.getByText(/not protected by Warmly/),
      page.locator(".sync-status"),
      page.getByRole("link", { name: "Back to the collection" }),
    ]) {
      await expect(hidden).toBeHidden();
    }
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Need and request");
    expect(body).not.toContain("Written by you");
    expect(body).not.toContain("sam@example.com");
  });

  test("prints black on white, and only when Print is pressed, with no request", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const counter = window as unknown as { printed: number };
      counter.printed = 0;
      window.print = () => {
        counter.printed += 1;
      };
    });
    await onThePrintScreen(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });
    const printed = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { printed: number }).printed);

    expect(await printed()).toBe(0);
    await page.getByRole("button", { name: "Print" }).click();
    expect(await printed()).toBe(1);
    expect(requests).toEqual([]);

    await page.emulateMedia({ media: "print" });
    const colours = await page
      .locator(".print-sheet__cards > li")
      .first()
      .evaluate((item) => {
        const style = getComputedStyle(item);
        return {
          ink: style.color,
          paper: getComputedStyle(document.body).backgroundColor,
          breaks: style.breakInside,
        };
      });
    expect(colours).toEqual({
      ink: "rgb(0, 0, 0)",
      paper: "rgb(255, 255, 255)",
      breaks: "avoid",
    });
  });
});
