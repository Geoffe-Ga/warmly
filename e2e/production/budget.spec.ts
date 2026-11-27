/**
 * How much a first visit downloads (PRD §8, UI-003).
 *
 * The budget is for every script and style sheet a first visit fetches,
 * as a browser receives them compressed: the ones the page names, any
 * chunk loaded later (the service worker caches all of them on the first
 * visit), and the service worker with its own runtime. It is measured on
 * the real production build, so a new dependency or a test double that
 * slips into it shows up here. Icons and the manifest are not counted.
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

    // Everything else the first visit fetches: the service worker, the
    // runtime it loads, and every script or style it caches straight away.
    const worker = await (await request.get("/sw.js")).text();
    const runtime = [...worker.matchAll(/["']\.\/(workbox-[\w-]+)["']/g)].map(
      (match) => `/${match[1] ?? ""}.js`,
    );
    const precached = [...worker.matchAll(/url:\s*"([^"]+\.(?:js|css))"/g)].map(
      (match) => `/${match[1] ?? ""}`,
    );
    expect(runtime.length).toBeGreaterThan(0);
    expect(precached.length).toBeGreaterThan(0);
    const all = [...new Set([...assets, "/sw.js", ...runtime, ...precached])];

    // The page must name its script and its styles, or nothing is measured.
    expect(assets.some((path) => path.endsWith(".js"))).toBe(true);
    expect(assets.some((path) => path.endsWith(".css"))).toBe(true);

    let total = 0;
    for (const path of all) {
      const response = await request.get(path);
      expect(response.ok(), path).toBe(true);
      total += gzipSync(await response.body(), { level: 9 }).length;
    }

    expect(
      total,
      `A first visit downloads ${String(total)} bytes compressed (${all.join(", ")}); the budget is ${String(INITIAL_BUDGET_BYTES)}.`,
    ).toBeLessThanOrEqual(INITIAL_BUDGET_BYTES);
    // A budget far above what is used protects nothing. If the app has
    // shrunk to under half of it, lower the budget.
    // Failing here is good news: lower INITIAL_BUDGET_BYTES above (and the
    // figure in CLAUDE.md and docs/support/browsers.md) to a little over
    // the new size.
    expect(
      total,
      `A first visit is now only ${String(total)} bytes compressed. Lower INITIAL_BUDGET_BYTES so the budget still protects something.`,
    ).toBeGreaterThan(INITIAL_BUDGET_BYTES / 2);
  });
});
