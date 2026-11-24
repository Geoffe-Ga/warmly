import { defineConfig, devices } from "@playwright/test";

const PRODUCTION_PORT = 4173;
const APP_PORT = 4174;
const PRODUCTION_URL = `http://localhost:${PRODUCTION_PORT}`;
const APP_URL = `http://localhost:${APP_PORT}`;
const isCI = Boolean(process.env["CI"]);

/**
 * E2E + accessibility suite. Browsers mirror PRD AC-28: mobile Safari and a
 * modern desktop browser. Two builds are served, both through `vite preview`
 * so the service worker, manifest and security headers behave as installed:
 *
 * - **production** (`e2e/production/`): exactly what ships. Used for what must
 *   be true of the real artefact: headers, the Content Security Policy, and
 *   that no test double or development tool is in the bundle.
 * - **app** (`e2e/app/`): the same production build with `--mode e2e`, which
 *   swaps in in-memory test doubles for external services and includes the
 *   component gallery. Used for feature flows, which cannot depend on a real
 *   auth server or AI provider.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "production-chromium",
      testDir: "e2e/production",
      use: { ...devices["Desktop Chrome"], baseURL: PRODUCTION_URL },
    },
    {
      name: "production-mobile-safari",
      testDir: "e2e/production",
      use: { ...devices["iPhone 15"], baseURL: PRODUCTION_URL },
    },
    {
      name: "app-chromium",
      testDir: "e2e/app",
      use: { ...devices["Desktop Chrome"], baseURL: APP_URL },
    },
    {
      name: "app-mobile-safari",
      testDir: "e2e/app",
      use: { ...devices["iPhone 15"], baseURL: APP_URL },
    },
  ],
  webServer: [
    {
      command: "npm run build && npm run preview",
      url: PRODUCTION_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: `npm run build:e2e && npm run preview:e2e -- --port ${APP_PORT}`,
      url: APP_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
