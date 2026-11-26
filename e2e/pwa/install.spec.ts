/**
 * What makes the app installable (PRD §8, UI-003; AC-28).
 *
 * A browser offers to install a web app when it has a manifest with a
 * name, a start page, standalone display and icons it can use, and a
 * service worker in control of the page. iOS takes its Home Screen icon
 * from a separate link in the page. These are checked against the built
 * app as it is served.
 *
 * This cannot press "Add to Home Screen" on a real phone: see
 * `docs/support/browsers.md` for what a person must check by hand.
 */
import { expect, test } from "../fixtures/test";

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly display: string;
  readonly start_url: string;
  readonly scope: string;
  readonly theme_color: string;
  readonly background_color: string;
  readonly icons: readonly ManifestIcon[];
}

/** The width and height written in a PNG file's header. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe("installing the app", () => {
  test("the manifest names the app, starts at its front page and opens without browser chrome", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const href = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(href).not.toBeNull();

    const response = await request.get(href ?? "");
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as Manifest;

    expect(manifest.name).toBe("Warmly");
    expect(manifest.short_name).toBe("Warmly");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test("the manifest has icons a phone and a desktop can use, and each file is the size it says", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const href = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    const manifest = (await (await request.get(href ?? "")).json()) as Manifest;
    const pngs = manifest.icons.filter((icon) => icon.type === "image/png");

    // Installing needs a 192 and a 512 pixel PNG; an adaptive icon needs
    // one marked maskable.
    expect(pngs.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(
      pngs.some(
        (icon) => icon.purpose === "maskable" && icon.sizes === "512x512",
      ),
    ).toBe(true);
    for (const icon of pngs) {
      const file = await request.get(`/${icon.src.replace(/^\//, "")}`);
      expect(file.ok(), icon.src).toBe(true);
      expect(file.headers()["content-type"]).toBe("image/png");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(await file.body()), icon.src).toEqual({ width, height });
    }
  });

  test("the page gives iOS a Home Screen icon it can use: a 180 pixel PNG", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const href = await page
      .locator('link[rel="apple-touch-icon"]')
      .getAttribute("href");

    expect(href).toMatch(/\.png$/);
    const file = await request.get(href ?? "");
    expect(file.ok()).toBe(true);
    expect(pngSize(await file.body())).toEqual({ width: 180, height: 180 });
  });

  test("a service worker takes control, and every file it cached can be served with the network off", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
    ).toBe(true);

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const each of await cache.keys()) {
          urls.push(each.url);
        }
      }
      return urls;
    });
    // The app shell: the page, its script and style, the manifest and the
    // icons a person sees when it is installed.
    // (A cached address can carry a revision after a "?", so the path is
    // what is compared.)
    const paths = cached.map((url) => new URL(url).pathname);
    expect(paths.some((path) => path.endsWith(".js"))).toBe(true);
    expect(paths.some((path) => path.endsWith(".css"))).toBe(true);
    expect(paths).toContain("/icon-192.png");
    expect(paths).toContain("/apple-touch-icon.png");

    await context.setOffline(true);
    const statuses = await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(async (url) => {
            const response = await caches.match(url);
            return response?.status ?? 0;
          }),
        ),
      cached,
    );
    expect(statuses.every((status) => status === 200)).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
