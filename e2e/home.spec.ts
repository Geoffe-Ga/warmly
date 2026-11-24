import { expect, test } from "@playwright/test";

test.describe("Home (UX-001)", () => {
  test("shows exactly three primary actions", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Warmly");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveText([
      "Journal",
      "Reflect",
      "Prepare for a Conversation",
    ]);
  });

  test("offers collections, settings and devices as secondary navigation", async ({
    page,
  }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Secondary" });
    await expect(nav.getByRole("link")).toHaveText([
      "Collections",
      "Settings",
      "Manage Devices",
    ]);
  });

  test("makes no network requests to AI providers on load (AC-03)", async ({
    page,
  }) => {
    const aiRequests: string[] = [];
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname;
      if (/(^|\.)(openai\.com|anthropic\.com)$/.test(host)) {
        aiRequests.push(request.url());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(aiRequests).toEqual([]);
  });

  test("links a valid web app manifest for PWA install", async ({ page }) => {
    await page.goto("/");

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
});
