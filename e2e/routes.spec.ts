import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/test";

import { ROUTES, pathFor } from "../src/app/routes";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SAMPLE_PARAMS = { id: "sample-1", cardId: "sample-2" };

test.describe("every MVP route (UX-001, AC-23)", () => {
  for (const route of ROUTES) {
    const path = pathFor(route.id, SAMPLE_PARAMS);

    test(`${route.id} loads directly at ${path} with one heading`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        route.title,
      );
      await expect(page.getByRole("main")).toHaveCount(1);
    });

    test(`${route.id} has no detectable WCAG 2.2 AA violations (AC-23)`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_22_AA)
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }

  test("navigating from Home moves focus to the new heading", async ({
    page,
  }) => {
    await page.goto("/");

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
    await page.goto("/settings/devices");

    await page.getByRole("link", { name: "Warmly home" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Manage Devices",
    );
  });

  test("the development-only component gallery is absent from the production build", async ({
    page,
  }) => {
    await page.goto("/dev/components");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Page not found",
    );

    const sources = await page
      .locator("script[src]")
      .evaluateAll((scripts) =>
        scripts.map((script) => (script as HTMLScriptElement).src),
      );
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const body = await (await page.request.get(source)).text();
      expect(body).not.toContain("Component gallery");
    }
  });

  test("an unknown path shows the not-found screen without echoing the path", async ({
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
