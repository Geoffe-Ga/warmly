import { cspHeader, securityHeaders } from "../../config/security-headers";
import { ROUTES, pathFor } from "../../src/app/routes";

import { expect, test } from "../fixtures/test";

const SAMPLE_PARAMS = { id: "sample-1", cardId: "sample-2" };
const EXPECTED = securityHeaders();
/** The app's own icons: the only images the service worker may cache. */
// (The precache list names files without a leading slash; a cached
// address has one.)
const OWN_ICON = /^\/?(icon-[a-z0-9-]+|apple-touch-icon)\.png$/;

test.describe("security headers (SEC-007)", () => {
  for (const route of ROUTES) {
    const path = pathFor(route.id, SAMPLE_PARAMS);

    test(`${route.id} is served with every security header`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      const headers = response?.headers() ?? {};

      for (const [name, value] of Object.entries(EXPECTED)) {
        expect(headers[name.toLowerCase()], name).toBe(value);
      }
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }

  test("the policy denies by default and allows no inline or eval code", () => {
    const policy = cspHeader();

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toMatch(/openai|anthropic/);
  });

  test("the built page also embeds the policy as a meta tag", async ({
    page,
  }) => {
    await page.goto("/");

    const content = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");

    expect(content).toContain("default-src 'none'");
    expect(content).not.toContain("frame-ancestors");
  });

  test("the service worker and manifest load under the policy", async ({
    page,
  }) => {
    await page.goto("/");

    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active !== null;
    });

    expect(registered).toBe(true);
  });
});

test.describe("the service worker caches the public app shell only (SYNC-001)", () => {
  test("the precache list holds static files, and no API route or runtime caching", async ({
    page,
  }) => {
    await page.goto("/");
    const worker = await (await page.request.get("/sw.js")).text();

    // Every precached URL is a static file of the build.
    const urls = [...worker.matchAll(/url:\s*"([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/\.(js|css|html|svg|png|webmanifest)$/);
      // The only images cached are the app's own icons.
      if (url.endsWith(".png")) {
        expect(url).toMatch(OWN_ICON);
      }
      expect(url).not.toContain("/v1/");
    }
    // Nothing is cached as the app runs: no runtime routes for the API or
    // anything else, only the navigation fallback to the shell.
    expect(worker).not.toContain("/v1/");
    expect(worker).not.toMatch(/StaleWhileRevalidate|NetworkFirst|CacheFirst/);
  });

  test("after a visit, Cache Storage holds only this origin's static files", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(async () => page.evaluate(async () => (await caches.keys()).length))
      .toBeGreaterThan(0);

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) {
          urls.push(request.url);
        }
      }
      return urls;
    });

    const origin = new URL(page.url()).origin;
    for (const each of cached) {
      const url = new URL(each);
      expect(url.origin).toBe(origin);
      expect(url.pathname).not.toMatch(/^\/v1\//);
      expect(url.pathname).toMatch(/\.(js|css|html|svg|png|webmanifest)$/);
      if (url.pathname.endsWith(".png")) {
        expect(url.pathname).toMatch(OWN_ICON);
      }
    }
  });
});

test.describe("the policy is enforced by the browser", () => {
  test.use({ expectCspViolation: true });

  test("inline scripts and string-evaluated code do not run", async ({
    page,
  }) => {
    await page.goto("/");

    const ran = await page.evaluate(async () => {
      const script = document.createElement("script");
      script.textContent = "window.__warmlyInlineRan = true;";
      document.head.append(script);
      // A string timer is compiled later by the page, like eval, so the
      // policy applies to it. (Playwright's own evaluate call is exempt.)
      setTimeout("window.__warmlyStringRan = true;", 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        inline: "__warmlyInlineRan" in window,
        evaluated: "__warmlyStringRan" in window,
      };
    });

    expect(ran).toEqual({ inline: false, evaluated: false });
  });

  test("a fetch to another host is refused by connect-src", async ({
    page,
  }) => {
    await page.goto("/");

    const failed = await page.evaluate(async () => {
      try {
        await fetch("https://rogue.example/collect");
        return false;
      } catch {
        return true;
      }
    });

    expect(failed).toBe(true);
  });
});

test.describe("egress guard self-test (AC-03)", () => {
  test.use({ expectedBlockedHosts: ["rogue.example"] });

  test("a navigation to a host outside the allowlist is aborted", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.goto("https://rogue.example/")).rejects.toThrow();
  });
});
