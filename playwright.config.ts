import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const DEV_PORT = 4174;
const DEV_URL = `http://localhost:${DEV_PORT}`;
const GALLERY_SPEC = /gallery\.spec\.ts$/;
const isCI = Boolean(process.env["CI"]);

/**
 * E2E + accessibility suite. Runs against the production build (`vite preview`)
 * so the service worker and manifest behave as they will when installed.
 * Browsers mirror PRD AC-28: mobile Safari and a modern desktop browser.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: GALLERY_SPEC,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      testIgnore: GALLERY_SPEC,
      use: { ...devices["iPhone 15"] },
    },
    // The component gallery exists only in development builds, so these two
    // projects run its spec against the dev server instead of the preview.
    {
      name: "gallery-chromium",
      testMatch: GALLERY_SPEC,
      use: { ...devices["Desktop Chrome"], baseURL: DEV_URL },
    },
    {
      name: "gallery-mobile-safari",
      testMatch: GALLERY_SPEC,
      use: { ...devices["iPhone 15"], baseURL: DEV_URL },
    },
  ],
  webServer: [
    {
      command: "npm run build && npm run preview",
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
      url: DEV_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
