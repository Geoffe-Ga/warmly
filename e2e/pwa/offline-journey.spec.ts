/**
 * The whole app with the network off (PRD SYNC-001, §8; AC-28,
 * AC-03).
 *
 * The app is loaded once and an account made while online. Then the
 * network goes, the page is reloaded from the service worker, and
 * everything that must work offline is done in one journey: write, leave a draft, edit, search,
 * delete, write and change cards, reorder them, present and print. Nothing
 * may throw, and when the network comes back what was done is sent.
 *
 * Asking AI is not in the journey: it needs a connection, by design.
 */
import AxeBuilder from "@axe-core/playwright";

import { onboard, unlockThisDevice } from "../app/account";
import { expect, test, type Page } from "../fixtures/test";

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

function entries(page: Page) {
  return page.getByRole("navigation", { name: "Entries" }).getByRole("link");
}

function cardRows(page: Page) {
  return page
    .getByRole("navigation", { name: "Cards in this collection" })
    .getByRole("listitem");
}

/** Go to Home. On Home itself the app's name is not a link. */
async function toHome(page: Page): Promise<void> {
  const home = page.getByRole("link", { name: "Warmly home" });
  if ((await home.count()) > 0) {
    await home.click();
  }
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

async function toJournal(page: Page): Promise<void> {
  await toHome(page);
  await page.getByRole("link", { name: "Journal", exact: true }).click();
}

async function writeEntry(page: Page, good: string): Promise<void> {
  await toJournal(page);
  await page.getByRole("link", { name: "Write a new entry" }).click();
  await page.getByLabel(PROMPTS[0] ?? "").fill(good);
  await page.getByLabel(PROMPTS[1] ?? "").fill("Synthetic second answer.");
  await page.getByLabel(PROMPTS[2] ?? "").fill("Synthetic third answer.");
  await page.getByRole("button", { name: "Save entry" }).click();
  await expect(page.getByText("A journal entry.")).toBeVisible();
}

/** One step of the journey, named for the report. */
type Step = readonly [name: string, run: (page: Page) => Promise<void>];

const OFFLINE_JOURNEY: readonly Step[] = [
  [
    "write an entry",
    async (page) => {
      await writeEntry(page, "Offline: we planted the tomatoes.");
      await toJournal(page);
      await expect(entries(page)).toHaveCount(2);
    },
  ],
  [
    "leave a draft and come back to it",
    async (page) => {
      await page.getByRole("link", { name: "Write a new entry" }).click();
      await page.getByLabel(PROMPTS[0] ?? "").fill("Offline draft, half done.");
      await expect(page.getByRole("main").getByRole("status")).toHaveText(
        "Saved on this device",
      );
      await toJournal(page);
      await page
        .getByRole("link", { name: /Carry on with your draft/ })
        .click();
      await expect(page.getByLabel(PROMPTS[0] ?? "")).toHaveValue(
        "Offline draft, half done.",
      );
    },
  ],
  [
    "edit an entry",
    async (page) => {
      await toJournal(page);
      await entries(page).last().click();
      await page.getByRole("link", { name: "Edit this entry" }).click();
      await page
        .getByLabel(PROMPTS[0] ?? "")
        .fill("Edited offline: the balcony at dusk.");
      await page.getByRole("button", { name: /^Save/ }).click();
      await expect(
        page.getByText("Edited offline: the balcony at dusk."),
      ).toBeVisible();
    },
  ],
  [
    "search",
    async (page) => {
      await toJournal(page);
      await page.getByLabel("Search your journal").fill("tomatoes");
      await expect(entries(page)).toHaveCount(1);
      await page.getByLabel("Search your journal").fill("balcony");
      await expect(entries(page)).toHaveCount(1);
      await page.getByLabel("Search your journal").fill("");
      await expect(entries(page)).toHaveCount(2);
    },
  ],
  [
    "delete an entry",
    async (page) => {
      await entries(page).first().click();
      await page.getByRole("button", { name: "Delete this entry" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete entry" })
        .click();
      await expect(
        page.getByText("It has been removed from this device."),
      ).toBeVisible();
      await toJournal(page);
      await expect(entries(page)).toHaveCount(1);
    },
  ],
  [
    "read the cards, write one, change one and reorder them",
    async (page) => {
      await toHome(page);
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Prepare for a Conversation" })
        .click();
      await page.getByRole("link", { name: /Sunday talk/ }).click();
      await expect(cardRows(page)).toHaveCount(2);
      await page
        .getByLabel("What do you want to say?")
        .fill("Written offline: could we cook on Friday?");
      await page.getByRole("button", { name: "Add card" }).click();
      await expect(cardRows(page)).toHaveCount(3);

      await cardRows(page).nth(0).getByRole("link").click();
      await page
        .getByLabel("What do you want to say?")
        .fill("Changed offline: thank you for Thursday.");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.locator(".card-reading").first()).toHaveText(
        "Changed offline: thank you for Thursday.",
      );
      await page.getByRole("link", { name: "Back to the collection" }).click();

      await cardRows(page)
        .nth(2)
        .getByRole("button", { name: /Move up/ })
        .click();
      await expect(page.getByText("Moved to position 2 of 3.")).toBeVisible();
      await expect(cardRows(page).nth(1).getByRole("link")).toContainText(
        "Written offline: could we cook on Friday?",
      );
    },
  ],
  [
    "present the cards",
    async (page) => {
      await page.getByRole("link", { name: "Present these cards" }).click();
      await expect(page.getByText("Card 1 of 3")).toBeVisible();
      await expect(page.locator(".present-card")).toHaveText(
        "Changed offline: thank you for Thursday.",
      );
      await page.getByRole("button", { name: "Next card" }).click();
      await expect(page.getByText("Card 2 of 3")).toBeVisible();
      await page
        .getByRole("link", { name: "Close and go back to the collection" })
        .click();
    },
  ],
  [
    "print the cards",
    async (page) => {
      await page.evaluate(() => {
        const counter = window as unknown as { printed: number };
        counter.printed = 0;
        window.print = () => {
          counter.printed += 1;
        };
      });
      await page.getByRole("link", { name: "Print these cards" }).click();
      const sheet = page.getByRole("region", { name: "What will be printed" });
      await expect(sheet.getByRole("listitem")).toHaveCount(3);
      // Opening the print view prints nothing; pressing Print does, once.
      expect(
        await page.evaluate(
          () => (window as unknown as { printed: number }).printed,
        ),
      ).toBe(0);
      await page.getByRole("button", { name: "Print" }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { printed: number }).printed,
        ),
      ).toBe(1);
    },
  ],
];

test.describe("the installed app, offline", () => {
  // Writing, editing, searching, deleting and leaving a presentation try
  // no network at all, so no AI is called (PRD AC-03).
  test("every offline-required feature works with the network off (AC-28)", async ({
    page,
    context,
  }) => {
    // The journey is long: many screens, each a real save to IndexedDB.
    test.slow();
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });

    // Online: an account, and the app shell in the cache.
    await onboard(page);
    const status = page.locator(".sync-status [role=status]");
    await expect(status).toHaveText("All changes saved");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    // The network goes, and the app is opened again from the cache.
    await context.setOffline(true);
    const requests: string[] = [];
    page.on("requestfailed", (request) => {
      requests.push(request.url());
    });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await unlockThisDevice(page);
    await expect(page.locator(".offline-notice")).toContainText("Offline:");

    // Everything from here on is made with no network: an entry, and a
    // collection with two cards. (The stand-in server in this build lives
    // in the page and starts empty after a reload, so records are made
    // after it, as they would be against a real server that was never
    // reached.)
    await writeEntry(page, "Written first: the balcony.");
    await toHome(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Prepare for a Conversation" })
      .click();
    await page.getByLabel("Name").fill("Sunday talk");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page.getByRole("link", { name: /Sunday talk/ }).click();
    for (const text of ["Thank you for Thursday.", "What would help you?"]) {
      await page.getByLabel("What do you want to say?").fill(text);
      await page.getByRole("button", { name: "Add card" }).click();
      await expect(page.getByLabel("What do you want to say?")).toHaveValue("");
    }

    for (const [name, run] of OFFLINE_JOURNEY) {
      await test.step(name, async () => {
        await run(page);
      });
    }
    await expectNoViolations(page);

    // Nothing threw, and nothing tried the network and failed: the app
    // knew it was offline and waited.
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    await expect(status).toContainText("waiting to sync");

    // Back online, everything that was done offline is sent.
    await context.setOffline(false);
    await expect(page.locator(".offline-notice")).toHaveText("");
    await expect(status).toHaveText("All changes saved", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
