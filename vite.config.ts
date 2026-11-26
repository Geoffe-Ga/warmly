/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import {
  connectSourcesFromEnv,
  cspMeta,
  securityHeaders,
  type ConnectSources,
} from "./config/security-headers.ts";

// Design references from the PRD (UI-001). These are brand colours, not
// guaranteed-accessible text colours; text contrast is handled in CSS tokens.
const CORAL = "#E35D7A";
const PAPER = "#FFF7F8";

/**
 * Embed the Content Security Policy in the built index.html. Build only: the
 * dev server injects inline styles for hot reload, which the policy forbids.
 */
function cspMetaPlugin(connectSources: ConnectSources): Plugin {
  return {
    name: "warmly-csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: cspMeta(connectSources),
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  // Origins the built app may connect to besides its own, set at build time
  // in the shell or a `.env` file. Unset means same-origin only.
  const connectSources = connectSourcesFromEnv(
    loadEnv(mode, process.cwd(), "VITE_"),
  );
  return {
    // `vite preview` stands in for the production host, so it sends the same
    // security headers the real host must send. The E2E suite asserts them.
    preview: {
      headers: securityHeaders(connectSources),
    },
    plugins: [
      cspMetaPlugin(connectSources),
      VitePWA({
        // "prompt" rather than "autoUpdate": the PRD requires a non-destructive
        // upgrade path for mixed frontend versions and offline clients, so the
        // app must decide when to activate a new service worker (never mid-draft).
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["icon.svg", "apple-touch-icon.png"],
        manifest: {
          name: "Warmly",
          short_name: "Warmly",
          description: "A private journal for relationship reflection.",
          theme_color: CORAL,
          background_color: PAPER,
          display: "standalone",
          start_url: "/",
          scope: "/",
          // PNGs are what phones and desktops use when the app is
          // installed. The maskable one has a full background, so a
          // launcher can cut it to its own shape. All are drawn from
          // `public/icon.svg`.
          icons: [
            {
              src: "icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
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
          globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
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
      // Process CSS so the contrast test can read the real token sheet.
      css: true,
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}", "config/**/*.ts"],
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
  };
});
