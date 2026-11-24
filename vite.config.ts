/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Design references from the PRD (UI-001). These are brand colours, not
// guaranteed-accessible text colours; text contrast is handled in CSS tokens.
const CORAL = "#E35D7A";
const PAPER = "#FFF7F8";

export default defineConfig({
  plugins: [
    VitePWA({
      // "prompt" rather than "autoUpdate": the PRD requires a non-destructive
      // upgrade path for mixed frontend versions and offline clients, so the
      // app must decide when to activate a new service worker (never mid-draft).
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Warmly",
        short_name: "Warmly",
        description: "A private journal for relationship reflection.",
        theme_color: CORAL,
        background_color: PAPER,
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        // Cache the public app shell only. Journal plaintext must never be
        // placed in a service-worker cache (PRD §5.1 SYNC-001).
        globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
        navigateFallback: "index.html",
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    include: ["tests/frontend/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/frontend/setup.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // main.tsx is the browser bootstrap (DOM lookup + SW registration) and is
      // exercised by the Playwright E2E suite instead of unit tests.
      exclude: ["src/**/*.d.ts", "src/main.tsx"],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});
