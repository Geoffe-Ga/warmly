/**
 * The installed app with the network off, and a suspended tab (PRD
 * SYNC-001, UI-008; AC-28, AC-02, AC-03, AC-21).
 *
 * Once the app shell is cached, the journal works with no network at all:
 * a reload comes from the service worker and an entry can be finished. The
 * service worker's caches hold the public app shell only.
 */
import AxeBuilder from "@axe-core/playwright";

import { OWN_ICON } from "../fixtures/icons";
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

/** Everything the service worker has cached: each URL and its body. */
async function cacheContents(
  page: Page,
): Promise<{ url: string; body: string }[]> {
  return page.evaluate(async () => {
    const found: { url: string; body: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        found.push({
          url: request.url,
          body: response === undefined ? "" : await response.text(),
        });
      }
    }
    return found;
  });
}

test.describe("offline", () => {
  test("load once, go offline, reload from the service worker, and finish an entry; the caches hold the app shell only", async ({
    page,
    context,
  }) => {
    await onboard(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const notice = page.locator(".offline-notice");
    await expect(notice).toHaveText("");

    await context.setOffline(true);
    await page.reload();

    // The page came from the service worker: there is no network.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(notice).toContainText("Offline:");
    await expect(notice).toContainText("Signing in needs a connection.");
    await expectNoViolations(page);
    await unlockThisDevice(page);
    await expect(notice).toHaveText(
      "Offline: your writing is saved on this device.",
    );
    await expectNoViolations(page);

    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("CANARY synthetic offline answer");
    }
    await page.getByRole("checkbox", { name: "calm" }).check();
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("A journal entry.")).toBeVisible();
    await expect(page.getByText("CANARY").first()).toBeVisible();
    await page.getByRole("link", { name: "Back to your journal" }).click();
    await expect(
      page.getByRole("navigation", { name: "Entries" }).getByRole("link"),
    ).toHaveCount(1);

    // Cache Storage: the public app shell, and nothing else.
    const cached = await cacheContents(page);
    expect(cached.length).toBeGreaterThan(0);
    const origin = new URL(page.url()).origin;
    for (const entry of cached) {
      const url = new URL(entry.url);
      expect(url.origin).toBe(origin);
      expect(url.pathname).not.toMatch(/^\/v1\//);
      expect(url.pathname).toMatch(
        /^\/$|\.(js|css|html|svg|png|webmanifest)$|^\/index\.html$/,
      );
      // The only images cached are the app's own icons.
      if (url.pathname.endsWith(".png")) {
        expect(url.pathname).toMatch(OWN_ICON);
      }
      expect(entry.body).not.toContain("CANARY");
      expect(entry.body).not.toContain("synthetic offline answer");
    }

    // Back online, the notice goes.
    await context.setOffline(false);
    await expect(notice).toHaveText("");
  });

  test("a tab suspended for more than 30 minutes resumes to the locked screen with the draft intact (AC-21)", async ({
    page,
  }) => {
    await page.clock.install();
    await onboard(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: "Write a new entry" }).click();
    await page
      .getByLabel(PROMPTS[0] ?? "")
      .fill("Synthetic: written before the tab was suspended");

    // The tab goes to the background. A suspended tab runs no timers, so
    // only the clock moves: nothing fires while it is away.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "Saved on this device",
    );
    await page.clock.setSystemTime(Date.now() + 31 * 60_000);

    // It comes back to the foreground.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(
      page.getByText("written before the tab was suspended"),
    ).toHaveCount(0);
    await unlockThisDevice(page);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.getByRole("link", { name: /Carry on with your draft/ }).click();
    await expect(page.getByLabel(PROMPTS[0] ?? "")).toHaveValue(
      "Synthetic: written before the tab was suspended",
    );
  });

  test("Settings says honestly whether the browser will keep this device's data", async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole("link", { name: "Settings" }).click();

    const line = page.getByTestId("storage-persistence");
    await expect(line).toBeVisible();
    // What the browser reported, one of the three honest answers.
    const persisted = await page.evaluate(async () =>
      "storage" in navigator && "persisted" in navigator.storage
        ? navigator.storage.persisted()
        : undefined,
    );
    if (persisted === true) {
      await expect(line).toContainText("has agreed to keep");
    } else {
      await expect(line).toContainText("may clear");
    }
    await expectNoViolations(page);
  });
});
