import AxeBuilder from "@axe-core/playwright";

import { ROUTES, pathFor } from "../../src/app/routes";
import { expect, test } from "../fixtures/test";

import { onboard, openInApp } from "./account";

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
