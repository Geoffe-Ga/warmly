import AxeBuilder from "@axe-core/playwright";

import { ROUTES, pathFor } from "../../src/app/routes";
import { expect, test, type Page } from "../fixtures/test";

import { onboard, openInApp, openMenu } from "./account";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SAMPLE_PARAMS = { id: "sample-1", cardId: "sample-2" };
const PRIVATE_ROUTES = ROUTES.filter((route) => route.access === "private");

test.describe("every private screen while unlocked (UX-001, AC-23)", () => {
  test("renders its heading and has no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    await onboard(page);

    for (const route of PRIVATE_ROUTES) {
      await openInApp(page, pathFor(route.id, SAMPLE_PARAMS));
      await expect(
        page.getByRole("heading", { level: 1 }),
        route.id,
      ).toHaveText(route.title);
      await expect(page.getByRole("main")).toHaveCount(1);

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_22_AA)
        .analyze();
      expect(results.violations, route.id).toEqual([]);
    }
  });

  test("navigating from Home moves focus to the new heading", async ({
    page,
  }) => {
    await onboard(page);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Reflect" })
      .click();

    await expect(page).toHaveURL(/\/reflect$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("the home link returns to Home and Back returns to the screen", async ({
    page,
  }) => {
    await onboard(page);
    await openMenu(page);
    await page.getByRole("link", { name: "Manage Devices" }).click();

    await page.getByRole("link", { name: "Warmly home" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Manage Devices",
    );
  });

  test("Lock is offered on every private screen (DEV-005)", async ({
    page,
  }) => {
    await onboard(page);

    for (const route of PRIVATE_ROUTES) {
      await openInApp(page, pathFor(route.id, SAMPLE_PARAMS));
      await expect(
        page.getByRole("button", { name: "Lock" }),
        route.id,
      ).toBeVisible();
    }
  });
});

/**
 * Wait until the page has stopped changing: nothing added, removed or
 * reworded for a short while. Gives up waiting after a few seconds, and
 * the measurement is then taken of whatever is there.
 */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const QUIET_MS = 300;
        const LIMIT_MS = 5000;
        let quiet = window.setTimeout(done, QUIET_MS);
        const limit = window.setTimeout(done, LIMIT_MS);
        const observer = new MutationObserver(() => {
          window.clearTimeout(quiet);
          quiet = window.setTimeout(done, QUIET_MS);
        });
        function done(): void {
          window.clearTimeout(quiet);
          window.clearTimeout(limit);
          observer.disconnect();
          resolve();
        }
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }),
  );
}

test.describe("large text (UI-003)", () => {
  test("no private screen scrolls sideways at double text size", async ({
    page,
  }) => {
    await onboard(page);

    for (const route of PRIVATE_ROUTES) {
      await openInApp(page, pathFor(route.id, SAMPLE_PARAMS));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // A screen fills in after its heading (a list loads, a status
      // arrives). Measure what it settles into, not a moment on the way.
      await settled(page);
      // Fonts differ between machines, and a wider one must not break a
      // screen that a narrower one fits. Much wider letter spacing stands
      // in for any wider font, so the answer is the same everywhere.
      for (const spacing of ["0", "0.3em"]) {
        const overflow = await page.evaluate((letterSpacing) => {
          const root = document.documentElement;
          root.style.fontSize = "200%";
          root.style.letterSpacing = letterSpacing;
          const extra = root.scrollWidth - root.clientWidth;
          root.style.fontSize = "";
          root.style.letterSpacing = "";
          return extra;
        }, spacing);
        expect(
          overflow,
          `${route.id}, letter spacing ${spacing}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe("signed-out access (DEV-005)", () => {
  for (const route of PRIVATE_ROUTES) {
    test(`${route.id} redirects to sign in and shows nothing private`, async ({
      page,
    }) => {
      await page.goto(pathFor(route.id, SAMPLE_PARAMS));

      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Sign in",
      );
      await expect(page.getByRole("navigation")).toHaveCount(0);
    });
  }

  test("an unknown path shows not-found without echoing the path", async ({
    page,
  }) => {
    await page.goto("/some-private-words-in-the-url");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Page not found",
    );
    await expect(page.locator("body")).not.toContainText("private-words");
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA)
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
