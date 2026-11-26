import AxeBuilder from "@axe-core/playwright";

import { ROUTES, pathFor } from "../../src/app/routes";
import { expect, test } from "../fixtures/test";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SAMPLE_PARAMS = { id: "sample-1", cardId: "sample-2" };

/**
 * The real production build. Until the real authentication client and key
 * vault land (issues #18 and #20), nobody can sign in here, so these tests
 * cover what a signed-out visitor sees and what must not be in the bundle.
 */
test.describe("production build: signed-out access (DEV-005)", () => {
  const NEEDS_SIGN_IN = ["private", "locked"];
  for (const route of ROUTES.filter((r) => NEEDS_SIGN_IN.includes(r.access))) {
    test(`${route.id} is not reachable signed out`, async ({ page }) => {
      await page.goto(pathFor(route.id, SAMPLE_PARAMS));

      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Sign in",
      );
    });
  }

  for (const route of ROUTES.filter((r) => !NEEDS_SIGN_IN.includes(r.access))) {
    test(`${route.id} renders and has no WCAG 2.2 AA violations (AC-23)`, async ({
      page,
    }) => {
      await page.goto(pathFor(route.id, SAMPLE_PARAMS));

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        route.title,
      );
      const results = await new AxeBuilder({ page })
        .withTags(WCAG_22_AA)
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("links a valid web app manifest for PWA install", async ({ page }) => {
    await page.goto("/sign-in");

    const href = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(href).toBeTruthy();
    const response = await page.request.get(href as string);
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as Record<string, unknown>;
    expect(manifest["name"]).toBe("Warmly");
    expect(manifest["display"]).toBe("standalone");
  });

  test("an unknown path shows not-found without echoing the path", async ({
    page,
  }) => {
    await page.goto("/some-private-words-in-the-url");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Page not found",
    );
    await expect(page.locator("body")).not.toContainText("private-words");
  });
});

test.describe("production build: no test doubles or development tools", () => {
  test("sign-in says accounts are unavailable instead of pretending", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("sam@example.com");
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "aren't available in this version",
    );
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("registration says accounts are unavailable too", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByLabel("Email").fill("sam@example.com");
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "aren't available in this version",
    );
  });

  test("the component gallery route does not exist", async ({ page }) => {
    await page.goto("/dev/components");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Page not found",
    );
  });

  test("no served script contains a double, its storage key or the gallery", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    const sources = await page
      .locator("script[src]")
      .evaluateAll((scripts) =>
        scripts.map((script) => (script as HTMLScriptElement).src),
      );
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const body = await (await page.request.get(source)).text();
      expect(body).not.toContain("Component gallery");
      expect(body).not.toContain("warmly.fake.");
      expect(body).not.toContain("FAKE-KEY0");
    }
  });

  test("nothing is written to web storage by a signed-out visit", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Create an account" }).click();

    const stored = await page.evaluate(() => ({
      session: sessionStorage.length,
      local: localStorage.length,
    }));

    expect(stored).toEqual({ session: 0, local: 0 });
  });
});
