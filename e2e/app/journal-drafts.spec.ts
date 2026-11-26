/**
 * Drafts in the browser (PRD JR-004, DEV-005; AC-02, AC-21).
 *
 * What is typed is saved as an encrypted draft on this device, so it is
 * still there after the page is closed and reopened offline, and after the
 * inactivity lock. Nothing calls AI or any other host: the fixture fails a
 * test that tries.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard, openInApp, unlockThisDevice } from "./account";

const GOOD = "What's going well?";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function openCompose(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await page.getByRole("link", { name: "Write a new entry" }).click();
  await expect(page.getByLabel(GOOD)).toBeVisible();
}

async function carryOn(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await page.getByRole("link", { name: /Carry on with your draft/ }).click();
}

/** Wait until unlocking has finished and the home screen is showing. */
async function unlocked(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

test.describe("journal drafts", () => {
  // A draft is still there after the page is closed and reopened offline
  // (PRD AC-02).
  test("offline: what is typed survives closing and reopening the page", async ({
    page,
    context,
  }) => {
    await onboard(page);
    // The app shell must be cached before the network goes away.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await openCompose(page);

    await page.getByLabel(GOOD).fill("Synthetic: half a thought, offline");
    await page.getByRole("checkbox", { name: "hopeful" }).check();
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "Saved on this device",
    );
    await expectNoViolations(page);

    // Closing and reopening the page, still offline.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await unlockThisDevice(page);
    await carryOn(page);

    await expect(page.getByLabel(GOOD)).toHaveValue(
      "Synthetic: half a thought, offline",
    );
    await expect(page.getByRole("checkbox", { name: "hopeful" })).toBeChecked();
    await expect(page.getByText(/carrying on with the draft/)).toBeVisible();
    await expectNoViolations(page);

    // The draft is not among the completed entries.
    await page.getByRole("link", { name: "Back to your journal" }).click();
    await expect(page.getByRole("navigation", { name: "Entries" })).toHaveCount(
      0,
    );
    await expectNoViolations(page);
  });

  test("the inactivity lock in the middle of writing keeps the text (AC-21)", async ({
    page,
  }) => {
    await page.clock.install();
    await onboard(page);
    await openCompose(page);

    // Typed, and then left alone before the usual save has happened.
    await page.getByLabel(GOOD).fill("Synthetic: typed just before the lock");
    await page.clock.fastForward("31:00");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(page.getByText("typed just before the lock")).toHaveCount(0);
    await unlockThisDevice(page);
    await carryOn(page);

    await expect(page.getByLabel(GOOD)).toHaveValue(
      "Synthetic: typed just before the lock",
    );
  });

  test("a lock or a reload in the middle of an edit keeps the unsaved changes, apart from the entry (AC-21, ADR-0015)", async ({
    page,
  }) => {
    await page.clock.install();
    await onboard(page);
    await openCompose(page);
    for (const box of await page.getByRole("textbox").all()) {
      await box.fill("Synthetic answer");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    const entryPath = new URL(page.url()).pathname;
    await page.getByRole("link", { name: "Edit this entry" }).click();

    // Typed, and then left alone before the usual save has happened.
    await page.getByLabel(GOOD).fill("Synthetic: changed just before the lock");
    await page.clock.fastForward("31:00");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(page.getByText("changed just before the lock")).toHaveCount(0);
    await unlockThisDevice(page);
    await unlocked(page);

    // The entry itself still says what it said.
    await openInApp(page, entryPath);
    await expect(page.getByText("Synthetic answer").first()).toBeVisible();
    await expect(page.getByText("changed just before the lock")).toHaveCount(0);

    // The changes are offered when the entry is edited again.
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await expect(page.getByLabel(GOOD)).toHaveValue(
      "Synthetic: changed just before the lock",
    );
    await expect(page.getByText("Unsaved changes brought back")).toBeVisible();
    await expectNoViolations(page);

    // They are still offered after the page is closed and opened again.
    await page.reload();
    await unlockThisDevice(page);
    await unlocked(page);
    await openInApp(page, `${entryPath}/edit`);
    await expect(page.getByLabel(GOOD)).toHaveValue(
      "Synthetic: changed just before the lock",
    );

    // Cancelling gives them up for good.
    await page
      .getByRole("button", { name: "Cancel and go back to the entry" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${entryPath}$`));
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await expect(page.getByLabel(GOOD)).toHaveValue("Synthetic answer");
    await expect(page.getByText("Unsaved changes brought back")).toHaveCount(0);
  });

  test("a draft is finished into one entry, or discarded after confirmation", async ({
    page,
  }) => {
    await onboard(page);
    await openCompose(page);
    await page.getByLabel(GOOD).fill("Synthetic: to be discarded");
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "Saved on this device",
    );

    await page.getByRole("button", { name: "Discard draft" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Discard this draft?",
    });
    await expect(dialog).toBeVisible();
    await expectNoViolations(page);
    await dialog.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByLabel(GOOD)).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Discard draft" }),
    ).toHaveCount(0);

    for (const box of await page.getByRole("textbox").all()) {
      await box.fill("Synthetic answer");
    }
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "Saved on this device",
    );
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page).toHaveURL(/\/journal\/entries\/[0-9a-f-]{36}$/);
    // Wait for the entry to load: its links move when it does, and a click
    // made too early can land on the wrong one.
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await page.getByRole("link", { name: "Back to your journal" }).click();

    await expect(
      page.getByRole("navigation", { name: "Entries" }).getByRole("link"),
    ).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Draft" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: "Write a new entry" }),
    ).toBeVisible();
  });
});
