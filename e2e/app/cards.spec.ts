/**
 * The Prepare flow in the browser (PRD CC-001, CC-007, CC-010, CC-012,
 * CC-013, SYNC-001; AC-13, AC-23).
 *
 * Collections and cards are encrypted and kept in IndexedDB like journal
 * entries, so they work offline and come back after a reload. Nothing here
 * calls AI: the fixture fails any test that contacts another host.
 *
 * Two devices of one account syncing cards is covered against the real
 * engine and protocol in `tests/frontend/sync/card-conflicts.test.ts`; in
 * a browser it needs the deployed stack (#63).
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard, unlockThisDevice } from "./account";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

const CARDS = [
  "Thank you for Thursday.",
  "Could we plan the weekend on Friday?",
  "What would make evenings easier for you?",
];

function rows(page: Page) {
  return page
    .getByRole("navigation", { name: "Cards in this collection" })
    .getByRole("listitem");
}

async function openPrepare(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Prepare for a Conversation" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Prepare for a Conversation",
  );
}

async function addCard(page: Page, text: string): Promise<void> {
  await page.getByLabel("What do you want to say?").fill(text);
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByLabel("What do you want to say?")).toHaveValue("");
}

test.describe("preparing for a conversation", () => {
  test("offline: make a collection and three cards, reorder them, and find them again after a reload", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await openPrepare(page);
    await expect(page.getByText("You have no collections yet.")).toBeVisible();
    await expectNoViolations(page);

    // Everything from here to the reload happens with no connection.
    await context.setOffline(true);
    await page.getByLabel("Name").fill("Sunday talk");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page
      .getByRole("navigation", { name: "Your collections" })
      .getByRole("link", { name: /Sunday talk/ })
      .click();

    // The name is the heading, never the address or the tab title.
    await expect(h1).toHaveText("Sunday talk");
    expect(page.url()).not.toMatch(/sunday/i);
    expect(await page.title()).not.toMatch(/sunday/i);

    for (const text of CARDS) {
      await addCard(page, text);
    }
    await expect(rows(page)).toHaveCount(3);
    await expectNoViolations(page);

    // Move the last card to the top with the keyboard.
    const moveUp = rows(page)
      .nth(2)
      .getByRole("button", { name: /Move up/ });
    await moveUp.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Moved to position 2 of 3.")).toBeVisible();
    await rows(page)
      .nth(1)
      .getByRole("button", { name: /Move up/ })
      .click();
    await expect(page.getByText("Moved to position 1 of 3.")).toBeVisible();
    await expect(rows(page).getByRole("link")).toContainText([
      CARDS[2] ?? "",
      CARDS[0] ?? "",
      CARDS[1] ?? "",
    ]);

    // Reload: the app locks, and after unlocking everything is as it was.
    await context.setOffline(false);
    await page.reload();
    await unlockThisDevice(page);
    await openPrepare(page);
    const collections = page.getByRole("navigation", {
      name: "Your collections",
    });
    await expect(collections.getByRole("link")).toContainText(["Sunday talk"]);
    await expect(collections.getByRole("link")).toContainText(["3 cards"]);
    await collections.getByRole("link").click();
    await expect(rows(page).getByRole("link")).toContainText([
      CARDS[2] ?? "",
      CARDS[0] ?? "",
      CARDS[1] ?? "",
    ]);

    // And it is sent to the server without being asked.
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );
  });

  test("edit a card, present, print, and delete with confirmation", async ({
    page,
  }) => {
    await onboard(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await openPrepare(page);
    await page.getByLabel("Name").fill("Money check-in");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page.getByRole("link", { name: /Money check-in/ }).click();
    await addCard(page, CARDS[0] ?? "");
    await addCard(page, CARDS[1] ?? "");

    // A card: change its words and its kind.
    await rows(page).nth(0).getByRole("link").click();
    await expect(h1).toHaveText("Card");
    await expect(page.getByText("Written by you.")).toBeVisible();
    await expectNoViolations(page);
    await page
      .getByLabel("What do you want to say?")
      .fill("Thank you for Thursday and Friday.");
    await page.getByRole("radio", { name: "Appreciation" }).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("heading", { name: "Appreciation" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to the collection" }).click();
    await expect(rows(page).nth(0).getByRole("link")).toContainText(
      "Thank you for Thursday and Friday.",
    );

    // Presentation: opens at card one, one card at a time, and starts at
    // card one again the next time (CC-012).
    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(h1).toHaveText("Presentation");
    await expect(page.getByText("Card 1 of 2")).toBeVisible();
    await expect(page.locator(".present-card")).toHaveText(
      "Thank you for Thursday and Friday.",
    );
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Next card" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Card 2 of 2")).toBeVisible();
    await page.getByRole("link", { name: "Back to the collection" }).click();
    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(page.getByText("Card 1 of 2")).toBeVisible();
    await page.getByRole("link", { name: "Back to the collection" }).click();

    // Print: the card text only.
    await page.getByRole("link", { name: "Print these cards" }).click();
    await expect(h1).toHaveText("Print");
    const sheet = page.getByRole("region", { name: "What will be printed" });
    await expect(sheet.getByRole("listitem")).toHaveCount(2);
    await expect(sheet).not.toContainText("Appreciation");
    await expectNoViolations(page);
    await page.getByRole("link", { name: "Back to the collection" }).click();

    // Deleting asks first, and cancelling keeps everything.
    await page.getByRole("button", { name: "Delete this collection" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Its 2 cards are deleted with it.");
    await expect(dialog).toContainText("There is no trash and no undo.");
    await expectNoViolations(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(rows(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Delete this collection" }).click();
    await dialog.getByRole("button", { name: "Delete collection" }).click();
    await expect(
      page.getByText(
        "The collection and its cards have been removed from this device.",
      ),
    ).toBeVisible();
    await expect(h1).toBeFocused();
    await page.getByRole("link", { name: "Back to your collections" }).click();
    await expect(page.getByText("You have no collections yet.")).toBeVisible();
  });
});
