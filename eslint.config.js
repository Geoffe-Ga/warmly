// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

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
