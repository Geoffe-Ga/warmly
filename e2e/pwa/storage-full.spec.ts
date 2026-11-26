/**
 * What happens when the device has no room left (PRD SYNC-001; AC-28).
 *
 * A browser refuses a write to IndexedDB with a `QuotaExceededError` when
 * the device, or the share of it the browser allows a site, is full. A
 * test cannot fill a real disk, so the page's IndexedDB is made to abort
 * the transaction of every write with that error, as a browser does. What the person typed must stay on the page,
 * the message must say what happened and what to do, and saving must work
 * again once there is room.
 */
import { onboard } from "../app/account";
import { expect, test, type Page } from "../fixtures/test";

const PROMPTS = [
  "What's going well?",
  "What would you like to improve?",
  "Since your last journal entry, how has your partner helped you feel loved?",
];

/** Make every IndexedDB write fail as a full device does, or stop doing so. */
async function setFull(page: Page, full: boolean): Promise<void> {
  await page.evaluate((refuse) => {
    (window as unknown as { warmlyTestFull: boolean }).warmlyTestFull = refuse;
  }, full);
}

test.describe("a device with no room left", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const flag = window as unknown as { warmlyTestFull?: boolean };
      const aborted = new WeakSet<IDBTransaction>();
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function refusing(
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        const request = put.apply(this, args);
        if (flag.warmlyTestFull === true && !aborted.has(this.transaction)) {
          aborted.add(this.transaction);
          // What a browser does when there is no room: the transaction is
          // aborted, nothing in it is kept, and its error says why.
          const transaction = this.transaction;
          Object.defineProperty(transaction, "error", {
            configurable: true,
            get: () =>
              new DOMException(
                "The quota has been exceeded.",
                "QuotaExceededError",
              ),
          });
          // A moment later, as a browser reports it: after the code that
          // asked for the write has finished what it was doing.
          queueMicrotask(() => {
            transaction.abort();
          });
        }
        return request;
      };
    });
  });

  test("keeps what was typed, says what happened and what to do, and saves once there is room", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    await setFull(page, true);
    await page
      .getByLabel(PROMPTS[0] ?? "")
      .fill("Typed while the device was full.");
    await page.getByLabel(PROMPTS[1] ?? "").fill("Synthetic second answer.");
    await page.getByLabel(PROMPTS[2] ?? "").fill("Synthetic third answer.");

    await page.getByRole("button", { name: "Save entry" }).click();

    await expect(
      page.getByText("because the device has no room left").first(),
    ).toBeVisible();
    await expect(
      page
        .getByText("Free some space on this device, then save again.")
        .first(),
    ).toBeVisible();
    // Never the browser's own words.
    await expect(page.getByText("QuotaExceededError")).toHaveCount(0);
    await expect(page.getByText("The quota has been exceeded.")).toHaveCount(0);
    // What was typed is still there.
    await expect(page.getByLabel(PROMPTS[0] ?? "")).toHaveValue(
      "Typed while the device was full.",
    );
    await expect(page.getByLabel(PROMPTS[2] ?? "")).toHaveValue(
      "Synthetic third answer.",
    );

    // Room again: the same Save now works.
    await setFull(page, false);
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(
      page.getByText("Typed while the device was full."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a card that cannot be stored stays in its box, with the same plain message", async ({
    page,
  }) => {
    await onboard(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Prepare for a Conversation" })
      .click();
    await page.getByLabel("Name").fill("Sunday talk");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page.getByRole("link", { name: /Sunday talk/ }).click();
    await page
      .getByLabel("What do you want to say?")
      .fill("Written while the device was full.");
    await setFull(page, true);

    await page.getByRole("button", { name: "Add card" }).click();

    await expect(
      page.getByText("because the device has no room left").first(),
    ).toBeVisible();
    await expect(page.getByLabel("What do you want to say?")).toHaveValue(
      "Written while the device was full.",
    );

    await setFull(page, false);
    await page.getByRole("button", { name: "Add card" }).click();
    await expect(page.getByText("Card added at the end.")).toBeVisible();
  });
});
