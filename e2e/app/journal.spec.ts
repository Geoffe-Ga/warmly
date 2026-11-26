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
  // The journal's screens are each checked with axe (PRD AC-23).
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
          rows +=
            name?.includes("-records-") === true && store === "records"
              ? found.length
              : 0;
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
    // One record. What else is stored depends on whether sync has run yet,
    // and all of it is scanned for the text below.
    expect(stored.rows).toBe(1);
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

  test("a blank or whitespace-only answer blocks saving; 'nothing to report' and chosen feelings pass (AC-02, JR-002, JR-003)", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    const [good, improve, loved] = PROMPTS.map((prompt) =>
      page.getByLabel(prompt),
    );
    if (good === undefined || improve === undefined || loved === undefined) {
      throw new Error("three prompts are expected");
    }

    await good.fill("Synthetic: nothing to report this week.");
    await improve.fill("   \n\t ");
    await page.getByRole("button", { name: "Save entry" }).click();

    // Nothing is saved; the two unanswered fields say what to do.
    await expect(page).toHaveURL(/\/journal\/new$/);
    await expect(good).not.toHaveAttribute("aria-invalid", "true");
    await expect(improve).toHaveAttribute("aria-invalid", "true");
    await expect(loved).toHaveAttribute("aria-invalid", "true");
    await expect(improve).toBeFocused();
    await expect(improve).toHaveAccessibleDescription(
      /Write something here to finish the entry/,
    );
    await expectNoViolations(page);

    await improve.fill("Nothing comes to mind this week");
    await expect(improve).not.toHaveAttribute("aria-invalid", "true");
    await loved.fill("Synthetic: nothing to report.");

    // The feelings check-in works from the keyboard alone.
    const feelings = page.getByRole("group", {
      name: "How are you feeling? (optional)",
    });
    await expect(feelings.getByRole("checkbox")).toHaveCount(11);
    await feelings.getByRole("checkbox", { name: "calm" }).focus();
    await page.keyboard.press("Space");
    await feelings.getByRole("checkbox", { name: "tired" }).check();
    await expect(
      feelings.getByRole("checkbox", { name: "calm" }),
    ).toBeChecked();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Save entry" }).click();

    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(
      page
        .locator("section.card")
        .filter({
          has: page.getByRole("heading", { name: "Feelings you noted" }),
        })
        .getByText("calm, tired"),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("offline: an entry is edited in place, the edit survives a reload, and its date does not change (AC-06, JR-006)", async ({
    page,
    context,
  }) => {
    await onboard(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("Synthetic first wording");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    // Wait for the entry itself: until it has loaded the heading is the
    // screen's name, not the entry's date.
    await expect(page.getByText("A journal entry.")).toBeVisible();
    const created = await page.getByRole("heading", { level: 1 }).innerText();
    expect(created).toMatch(/\d{4}/);
    const entryUrl = page.url();

    await context.setOffline(true);
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Edit journal entry",
    );
    await expect(page.getByText(`Your entry from ${created}.`)).toBeVisible();
    await expect(page.getByLabel(PROMPTS[0] ?? "")).toHaveValue(
      "Synthetic first wording",
    );
    await expectNoViolations(page);

    // The same rule as for a new entry: an empty answer is not saved.
    await page.getByLabel(PROMPTS[1] ?? "").fill("  ");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByLabel(PROMPTS[1] ?? "")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page).toHaveURL(/\/edit$/);
    await expectNoViolations(page);

    await page.getByLabel(PROMPTS[0] ?? "").fill("Synthetic rewritten wording");
    await page.getByLabel(PROMPTS[1] ?? "").fill("Synthetic second answer");
    await page.getByRole("checkbox", { name: "grateful" }).check();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(entryUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(created);
    await expect(page.getByText("Synthetic rewritten wording")).toBeVisible();
    // Only the third answer still has the first wording.
    await expect(page.getByText("Synthetic first wording")).toHaveCount(1);

    // Still offline: reload, unlock, and the edit is there under one entry.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(entries(page)).toHaveCount(1);
    await expect(entries(page).first()).toHaveText(created);
    await entries(page).first().click();
    await expect(page.getByText("Synthetic rewritten wording")).toBeVisible();
    await expect(page.getByText("Synthetic second answer")).toBeVisible();
    await expect(page.getByText("grateful")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(created);
  });

  test("offline: an entry is deleted for good after confirmation, stays gone after a reload, and one delete is queued (AC-17, JR-007)", async ({
    page,
    context,
  }) => {
    await onboard(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("Synthetic entry to delete");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();

    await context.setOffline(true);
    await page.getByRole("button", { name: "Delete this entry" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Delete this entry for good?",
    });
    await expect(dialog).toContainText("There is no trash and no undo.");
    await expect(dialog).toContainText("within 30 days");
    await expectNoViolations(page);

    // Backing out keeps the entry.
    await dialog.getByRole("button", { name: "Keep this entry" }).click();
    await expect(
      page.getByText("Synthetic entry to delete").first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete this entry" }).click();
    await dialog.getByRole("button", { name: "Delete entry" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Entry deleted",
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByText("Synthetic entry to delete")).toHaveCount(0);
    await expectNoViolations(page);

    // Still offline: reload and unlock. The entry stays gone.
    await page.reload();
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(
      page.getByText("You haven't written anything yet."),
    ).toBeVisible();
    await page.getByLabel("Search your journal").fill("Synthetic entry");
    await expect(entries(page)).toHaveCount(0);

    // What is stored: a tombstone with no ciphertext, and one queued delete.
    const stored = await page.evaluate(async () => {
      const name = (await indexedDB.databases())
        .map((database) => database.name ?? "")
        .find((each) => each.includes("-records-"));
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(name ?? "");
        opening.onsuccess = () => {
          resolve(opening.result);
        };
        opening.onerror = () => {
          reject(new Error("could not open the records database"));
        };
      });
      const read = (store: string): Promise<Record<string, unknown>[]> =>
        new Promise((resolve, reject) => {
          const reading = database
            .transaction(store)
            .objectStore(store)
            .getAll();
          reading.onsuccess = () => {
            resolve(reading.result as Record<string, unknown>[]);
          };
          reading.onerror = () => {
            reject(new Error("could not read a store"));
          };
        });
      const records = await read("records");
      const outbox = await read("outbox");
      database.close();
      return {
        records: records.map((row) => ({
          tombstone: row["tombstone"],
          hasCiphertext: row["envelope"] !== null,
        })),
        deletes: outbox.filter((operation) => operation["tombstone"] === true)
          .length,
      };
    });
    expect(stored.records).toEqual([{ tombstone: true, hasCiphertext: false }]);
    expect(stored.deletes).toBe(1);
  });

  test("offline: search finds an entry by its words, shows a snippet and a count, and opens it (AC-06, JR-010)", async ({
    page,
    context,
  }) => {
    await onboard(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    for (const text of [
      "Synthetic: we cooked DINNER together",
      "Synthetic: a long walk by the canal",
    ]) {
      await page.getByRole("link", { name: "Journal", exact: true }).click();
      await page.getByRole("link", { name: "Write a new entry" }).click();
      for (const prompt of PROMPTS) {
        await page.getByLabel(prompt).fill(text);
      }
      await page.getByRole("button", { name: "Save entry" }).click();
      await expect(page.getByText("A journal entry.")).toBeVisible();
      await page.getByRole("link", { name: "Warmly" }).click();
    }

    await context.setOffline(true);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(entries(page)).toHaveCount(2);
    const count = page.locator(".result-count");
    await expect(count).toHaveText("");

    // Case does not matter, and the last word may be unfinished.
    await page.getByLabel("Search your journal").fill("cooked din");
    await expect(entries(page)).toHaveCount(1);
    await expect(count).toHaveText("1 entry found.");
    await expect(count).toHaveAttribute("aria-live", "polite");
    await expect(entries(page).first()).toContainText(
      "Synthetic: we cooked DINNER together",
    );
    await expectNoViolations(page);

    // Every word must match, and a word is not found inside another.
    await page.getByLabel("Search your journal").fill("cooked canal");
    await expect(count).toHaveText("No entry mentions that.");
    await page.getByLabel("Search your journal").fill("inner");
    await expect(count).toHaveText("No entry mentions that.");
    await expectNoViolations(page);

    await page.getByLabel("Search your journal").fill("synthetic");
    await expect(count).toHaveText("2 entries found.");

    // What was typed is nowhere but the box.
    await expect(page).toHaveURL(/\/journal$/);
    const stored = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    expect(stored.toLowerCase()).not.toContain("synthetic");

    await page.getByLabel("Search your journal").fill("CANAL");
    await entries(page).first().click();
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    await expect(
      page.getByText("Synthetic: a long walk by the canal").first(),
    ).toBeVisible();
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
