/**
 * Two accounts in one browser never see each other (PRD SEC-005, SEC-006;
 * AC-04, AC-27).
 *
 * Accounts are independent: there is no partner link and nothing is shared.
 * This runs both accounts in the same browser profile, the closest two
 * accounts can get, and checks that the second finds no trace of the first:
 * not in its journal, not in search, not at the first one's addresses, and
 * not in anything the browser has stored. Cross-account attacks on the API
 * itself run against the real server and database in `tests/security/`.
 */
import { expect, test, type Page } from "../fixtures/test";

import { onboard, unlockThisDevice } from "./account";

const PROMPTS = [
  "What's going well?",
  "What would you like to improve?",
  "Since your last journal entry, how has your partner helped you feel loved?",
];
const CANARY = "CANARY-A synthetic private sentence";

/** Everything the browser has stored for this site, as text. */
async function everythingStored(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const text = (value: unknown): string =>
      new TextDecoder().decode(value as Uint8Array);
    const dump: unknown[] = [
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ];
    for (const { name } of await indexedDB.databases()) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(name ?? "");
        opening.onsuccess = () => {
          resolve(opening.result);
        };
        opening.onerror = () => {
          reject(new Error("could not open a database"));
        };
      });
      for (const store of [...database.objectStoreNames]) {
        const found = await new Promise<unknown[]>((resolve, reject) => {
          const reading = database
            .transaction(store)
            .objectStore(store)
            .getAll();
          reading.onsuccess = () => {
            resolve(reading.result);
          };
          reading.onerror = () => {
            reject(new Error("could not read a store"));
          };
        });
        dump.push(store, found);
      }
      database.close();
    }
    return JSON.stringify(dump, (_key, value: unknown) =>
      ArrayBuffer.isView(value) ? text(value) : value,
    );
  });
}

test.describe("two accounts in one browser", () => {
  test("the second account finds no trace of the first one's journal", async ({
    page,
  }) => {
    // Account A writes an entry.
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill(CANARY);
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(page.getByText(CANARY).first()).toBeVisible();
    const entryOfA = new URL(page.url()).pathname;
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );

    // A signs out, and B makes an account in the same browser.
    await page.getByRole("button", { name: "Sign out" }).click();
    await onboard(page, "robin@example.com");

    // B's journal is empty, and searching finds nothing.
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Entries" }).getByRole("link"),
    ).toHaveCount(0);
    await expect(page.getByText("CANARY")).toHaveCount(0);

    // A's entry address shows B nothing. Going there inside the app keeps
    // B unlocked, so what is shown is what B's keys can read.
    await page.evaluate((path) => {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, entryOfA);
    await expect(
      page.getByText(/This entry isn't on this device/),
    ).toBeVisible();
    await expect(page.getByText("CANARY")).toHaveCount(0);

    // The same address after a reload, which locks the app, is no different.
    await page.goto(entryOfA);
    await unlockThisDevice(page);
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await expect(page.getByText("CANARY")).toHaveCount(0);

    // Nothing either account stored in this browser is readable as text:
    // A's entry is there only as ciphertext B has no key for.
    const stored = await everythingStored(page);
    expect(stored).not.toContain("CANARY");
    expect(stored).not.toContain("synthetic private sentence");

    // And B's status line says nothing about anyone else's changes.
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );
  });
});
