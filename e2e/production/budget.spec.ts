/**
 * How much a first visit downloads (PRD §8, UI-003; AC-28).
 *
 * The budget is for what the page needs before it can show anything: the
 * script and style sheet named in the HTML, as a browser receives them
 * compressed. It is measured on the real production build, so a new
 * dependency or a test double that slips into it shows up here.
 *
 * Raising the budget is a decision, not a fix: say why in the PR.
 */
import { gzipSync } from "node:zlib";

import { expect, test } from "../fixtures/test";

/** The most a first visit may download, compressed, in bytes. */
const INITIAL_BUDGET_BYTES = 150 * 1024;

test.describe("production build: download size", () => {
  test("the script and styles a first visit needs fit the budget", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();
    const assets = [
      ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
      ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
    ].map((match) => match[1] ?? "");

    // The page must name its script and its styles, or nothing is measured.
    expect(assets.some((path) => path.endsWith(".js"))).toBe(true);
    expect(assets.some((path) => path.endsWith(".css"))).toBe(true);

    let total = 0;
    for (const path of assets) {
      const response = await request.get(path);
      expect(response.ok(), path).toBe(true);
      total += gzipSync(await response.body(), { level: 9 }).length;
    }

    expect(
      total,
      `A first visit downloads ${String(total)} bytes compressed; the budget is ${String(INITIAL_BUDGET_BYTES)}.`,
    ).toBeLessThanOrEqual(INITIAL_BUDGET_BYTES);
    // A budget far above what is used protects nothing. If the app has
    // shrunk to under half of it, lower the budget.
    expect(total).toBeGreaterThan(INITIAL_BUDGET_BYTES / 2);
  });
});
