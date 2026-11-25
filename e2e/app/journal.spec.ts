/**
 * The journal flow in the browser (PRD JR-001; AC-23).
 *
 * Entries are encrypted and kept in IndexedDB (PRD SYNC-001), so they come
 * back after a lock and after a reload. Nothing calls AI: the fixture fails
 * any test that contacts another host.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard, unlockThisDevice } from "./account";

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

test.describe("the journal", () => {
  test("from Home to the journal, a new entry, the timeline, the entry and back", async ({
    page,
  }) => {
    await onboard(page);

    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Journal");
    await expect(
      page.getByText("You haven't written anything yet."),
    ).toBeVisible();
    await expect(page.getByText(/not saved/i)).toHaveCount(0);
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Write a new entry" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "New journal entry",
    );
    const boxes = page.getByRole("textbox");
    await expect(boxes).toHaveCount(3);
    for (const [index, prompt] of PROMPTS.entries()) {
      await expect(page.getByLabel(prompt)).toBeVisible();
      await page
        .getByLabel(prompt)
        .fill(`Synthetic answer ${String(index + 1)}`);
    }
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Save entry" }).click();

    // The new entry opens, with each answer under its question.
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    for (const [index, prompt] of PROMPTS.entries()) {
      const section = page
        .locator("section.card")
        .filter({ has: page.getByRole("heading", { level: 2, name: prompt }) });
      await expect(
        section.getByText(`Synthetic answer ${String(index + 1)}`),
      ).toBeVisible();
    }
    await expectNoViolations(page);

    // Back in the timeline it is listed first, and search finds it.
    await page.getByRole("link", { name: "Back to your journal" }).click();
    await expect(entries(page)).toHaveCount(1);
    await page.getByLabel("Search your journal").fill("no such words");
    await expect(page.getByText("No entry mentions that.")).toBeVisible();
    await page.getByLabel("Search your journal").fill("SYNTHETIC ANSWER 2");
    await expect(entries(page)).toHaveCount(1);
    await expect(page).toHaveURL(/\/journal$/);
    await expectNoViolations(page);
    await entries(page).first().click();
    await expect(page.getByText("Synthetic answer 3")).toBeVisible();

    await page.getByRole("link", { name: "Warmly" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });

  test("an entry comes back after a lock and after a reload, and is stored only as ciphertext", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("CANARY synthetic private sentence");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("CANARY").first()).toBeVisible();

    // Nothing the browser stores holds the words that were typed.
    const stored = await page.evaluate(async () => {
      const text = (bytes: ArrayBufferView): string =>
        new TextDecoder("latin1").decode(bytes);
      const dump: unknown[] = [{ ...localStorage }, { ...sessionStorage }];
      let rows = 0;
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
          rows += name?.includes("-records-") === true ? found.length : 0;
          dump.push(name, store, found);
        }
        database.close();
      }
      return {
        rows,
        text: JSON.stringify(dump, (_key, value: unknown) =>
          ArrayBuffer.isView(value) ? text(value) : value,
        ),
      };
    });
    // One record and one queued operation.
    expect(stored.rows).toBe(2);
    expect(stored.text).not.toContain("CANARY");
    expect(stored.text).not.toContain("synthetic private sentence");

    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(page.getByText("CANARY")).toHaveCount(0);
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(entries(page)).toHaveCount(1);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(entries(page)).toHaveCount(1);
    await entries(page).first().click();
    await expect(page.getByText("CANARY").first()).toBeVisible();
    await expectNoViolations(page);
  });

  test("an entry that is not on this device says so", async ({ page }) => {
    await onboard(page);
    await page.evaluate(() => {
      window.history.pushState(
        null,
        "",
        "/journal/entries/00000000-0000-4000-8000-0000000000ff",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await expect(
      page.getByText("This entry isn't on this device."),
    ).toBeVisible();
    await expectNoViolations(page);
  });
});
