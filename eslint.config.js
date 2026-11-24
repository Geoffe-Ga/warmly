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
    files: ["*.config.{js,ts}", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Logging is a privacy risk (PRD §8): no stray console output of content.
      "no-console": "error",
    },
  },
  prettier,
);
