/**
 * Serves the spike page on localhost, opens it in Chromium and prints what
 * the page could and could not read from each provider (ADR-0007).
 *
 * Usage: node spikes/ai-browser/probe.mjs
 *
 * No key is used. Every request carries a key that is not a key.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript" };

const server = createServer(async (request, response) => {
  const name = request.url === "/" ? "index.html" : request.url.slice(1);
  if (!["index.html", "probe-page.js"].includes(name)) {
    response.writeHead(404).end();
    return;
  }
  const type = TYPES[name.slice(name.lastIndexOf("."))];
  response.writeHead(200, { "content-type": type });
  response.end(await readFile(join(here, name)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const browser = await chromium.launch(
  proxy === undefined ? {} : { proxy: { server: proxy, bypass: "127.0.0.1" } },
);
const requests = [];
try {
  const page = await browser.newPage();
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.spikeResults !== undefined, null, {
    timeout: 90_000,
  });
  const results = await page.evaluate(() => window.spikeResults);
  process.stdout.write(
    `${JSON.stringify({ origin, userAgent: await page.evaluate(() => navigator.userAgent), requests, results }, null, 2)}\n`,
  );
} finally {
  await browser.close();
  server.close();
}
