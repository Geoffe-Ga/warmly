/**
 * Reviewing an entry that was changed in two places (PRD SYNC-004,
 * SYNC-010; AC-16, AC-23).
 *
 * The `e2e` build's server lives inside one page, so a second device cannot
 * take part. Its side is put in place the way sync leaves it: the other
 * version, still encrypted, in the local `parked` store beside an entry
 * with an unsent change. Two devices syncing into that state is covered by
 * the unit tests (`tests/frontend/sync/conflicts.test.ts`).
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import { onboard, unlockThisDevice } from "./account";
import { parkStoredVersion } from "./conflict";

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

test.describe("an entry changed in two places", () => {
  // Both versions are shown and the person keeps either one (PRD AC-16).
  // The screen passes axe and works from the keyboard (AC-23).
  test("shows both versions, keeps the one chosen, and removes the other", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const status = page.locator(".sync-status [role=status]");
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("Synthetic first version");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(status).toHaveText("All changes saved");

    // The version stored now becomes "the other device's"; then this
    // device changes the entry without being able to send it.
    await parkStoredVersion(page);
    await context.setOffline(true);
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await page.getByLabel(PROMPTS[0] ?? "").fill("Synthetic second version");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();

    // The entry is still readable, and says there are two versions.
    await expect(page.getByText("Synthetic second version")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Review the two versions" }),
    ).toBeVisible();
    // After a lock and unlock the status still says so.
    await page.getByRole("button", { name: "Lock" }).click();
    await unlockThisDevice(page);
    await expect(status).toHaveText("Needs your attention");
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Review what changed" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Changed in two places",
    );
    const mine = page.locator(".card", { hasText: "On this device" });
    const theirs = page.locator(".card", { hasText: "On your other device" });
    await expect(mine).toContainText("Synthetic second version");
    await expect(theirs).toContainText("Synthetic first version");
    await expect(theirs).not.toContainText("Synthetic second version");
    await expectNoViolations(page);

    // Keyboard only: reach the button and press it.
    const keep = page.getByRole("button", { name: "Keep the other version" });
    await keep.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(
      page.getByText(/Kept the version from your other device/),
    ).toBeVisible();
    await expect(page.getByText("Nothing needs your attention.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Keep/ })).toHaveCount(0);
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Back to your journal" }).click();
    await page
      .getByRole("navigation", { name: "Entries" })
      .getByRole("link")
      .first()
      .click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(page.getByText("Synthetic second version")).toHaveCount(0);
    await expect(
      page.getByText("Synthetic first version").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Review the two versions" }),
    ).toHaveCount(0);
  });

  // The person may write one version from both (PRD AC-16).
  test("writing one version from both keeps what was written", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const status = page.locator(".sync-status [role=status]");
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("Synthetic first version");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(status).toHaveText("All changes saved");
    await parkStoredVersion(page);
    await context.setOffline(true);
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await page.getByLabel(PROMPTS[0] ?? "").fill("Synthetic second version");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();

    await page.getByRole("link", { name: "Review the two versions" }).click();
    await page.getByRole("button", { name: "Write one from both" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Write one version from both",
    );
    await expect(page.getByLabel(PROMPTS[0] ?? "")).toHaveValue(
      "Synthetic second version",
    );
    await expectNoViolations(page);

    // An empty answer is refused, and focus goes to it.
    await page.getByLabel(PROMPTS[1] ?? "").fill("");
    await page.getByRole("button", { name: "Save this version" }).click();
    await expect(page.getByLabel(PROMPTS[1] ?? "")).toBeFocused();

    await page.getByLabel(PROMPTS[1] ?? "").fill("Synthetic, from both");
    await page.getByRole("button", { name: "Save this version" }).click();
    await expect(page.getByText(/Saved the version you wrote/)).toBeVisible();

    await page.getByRole("link", { name: "Back to your journal" }).click();
    await page
      .getByRole("navigation", { name: "Entries" })
      .getByRole("link")
      .first()
      .click();
    await expect(page.getByText("Synthetic, from both")).toBeVisible();
    await expect(page.getByText("Synthetic second version")).toBeVisible();
  });

  test("an entry deleted on another device stays deleted, and what was written here can be saved as a new entry", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const status = page.locator(".sync-status [role=status]");
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("Synthetic first version");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(status).toHaveText("All changes saved");
    const entryUrl = page.url();

    // Another device deletes the entry. This one, offline since before
    // that, changes it.
    await parkStoredVersion(page, true);
    await context.setOffline(true);
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await page.getByLabel(PROMPTS[0] ?? "").fill("Synthetic written after");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();

    await page.getByRole("link", { name: "Review the two versions" }).click();
    await expect(
      page.getByText(/deleted on another device after you changed it here/),
    ).toBeVisible();
    await expect(
      page.locator(".card", { hasText: "On this device" }),
    ).toContainText("Synthetic written after");
    await expectNoViolations(page);

    await page.getByRole("button", { name: "Save as a new entry" }).click();
    await expect(
      page.getByText(/Saved what you wrote as a new entry/),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expectNoViolations(page);

    // The text is in the journal once, under a new entry.
    await page.getByRole("link", { name: "Back to your journal" }).click();
    const entries = page
      .getByRole("navigation", { name: "Entries" })
      .getByRole("link");
    await expect(entries).toHaveCount(1);
    await entries.first().click();
    await expect(page.getByText("Synthetic written after")).toBeVisible();
    expect(page.url()).not.toBe(entryUrl);

    // The old entry stays deleted: its address shows nothing.
    await page.goto(entryUrl);
    await unlockThisDevice(page);
    await expect(page.getByText("Synthetic written after")).toHaveCount(0);
    await expect(page.getByText("Synthetic first version")).toHaveCount(0);
  });
});
