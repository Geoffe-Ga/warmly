// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Modules that are an AI provider: the stand-in now, the adapters later. */
const AI_PROVIDER_MODULES = {
  group: ["**/fake-provider", "**/ai/providers/*"],
  message:
    "Only src/ai/gateway.ts may import an AI provider (D-17). Call services.ai.",
};

/** The module that makes consent tokens. */
const AI_CONSENT_MODULE = {
  group: ["**/ai/consent", "./consent"],
  message:
    "Only the disclosure dialog may make a consent token (SEC-009). Show AiDisclosureDialog.",
};

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "dev-dist/",
      "dist-e2e/",
      "coverage/",
      "node_modules/",
      "playwright-report/",
      "test-results/",
      "reports/",
      ".stryker-tmp/",
      ".venv/",
      "htmlcov/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/frontend/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.config.{js,ts}", "e2e/**/*.ts", "config/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Logging is a privacy risk (PRD §8): no stray console output of content.
      "no-console": "error",
    },
  },
  {
    // Only the gateway may hold or call an AI provider (decision D-17), so
    // that "no consent, no call" cannot be walked around.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ai/gateway.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [AI_PROVIDER_MODULES] }],
    },
  },
  {
    // A consent token is made in one place: the confirm button of the
    // disclosure dialog (PRD SEC-009). Nothing else may import the module
    // that makes them.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ai/gateway.ts", "src/ui/components/AiDisclosureDialog.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [AI_PROVIDER_MODULES, AI_CONSENT_MODULE] },
      ],
    },
  },
  {
    // Every E2E spec must use the project's `test`, which fails any test that
    // contacts a host outside the allowlist or triggers a CSP violation.
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              message:
                "Import { test, expect } from '../fixtures/test' so the egress guard applies.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
