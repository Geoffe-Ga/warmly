import { describe, expect, it } from "vitest";

import {
  NON_TEXT_PAIRS,
  TEXT_PAIRS,
  contrastRatio,
  parseTokens,
} from "../../../src/ui/contrast";
import css from "../../../src/styles.css?raw";

const tokens = parseTokens(css);

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for identical colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#e35d7a", "#e35d7a")).toBe(1);
  });

  it("does not depend on argument order", () => {
    expect(contrastRatio("#2e2a2b", "#fff7f8")).toBe(
      contrastRatio("#fff7f8", "#2e2a2b"),
    );
  });

  it("accepts three-digit hex colours", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
  });

  it("rejects a value that is not a hex colour", () => {
    expect(() => contrastRatio("coral", "#fff")).toThrow(/hex colour/i);
  });
});

describe("parseTokens", () => {
  it("reads custom properties from the :root block", () => {
    expect(
      parseTokens(":root { --color-ink: #2E2A2B; --space: 1rem; }"),
    ).toEqual({ "--color-ink": "#2e2a2b", "--space": "1rem" });
  });

  it("fails loudly when there is no :root block", () => {
    expect(() => parseTokens("body { color: red; }")).toThrow(/:root/);
  });
});

describe("design tokens (UI-001, WCAG 2.2 AA)", () => {
  it("keeps the PRD brand references", () => {
    expect(tokens["--color-coral"]).toBe("#e35d7a");
    expect(tokens["--color-blush"]).toBe("#fde4e8");
    expect(tokens["--color-soft-pink"]).toBe("#f7a7b5");
    expect(tokens["--color-paper"]).toBe("#fff7f8");
    expect(tokens["--color-ink"]).toBe("#2e2a2b");
  });

  it.each(TEXT_PAIRS)("%s on %s meets 4.5:1 for text", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s against %s meets 3:1 for UI", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  it("shows why the brand coral is not used for text", () => {
    expect(
      contrastRatio(token("--color-coral"), token("--color-paper")),
    ).toBeLessThan(4.5);
  });

  it("uses only tokens for colour outside the :root block", () => {
    const rules = css.slice(css.indexOf("}", css.indexOf(":root")) + 1);

    expect(rules.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it("sets no colour in a component: every colour comes from the stylesheet's tokens", () => {
    const sources = import.meta.glob<string>("../../../src/**/*.{ts,tsx}", {
      eager: true,
      query: "?raw",
      import: "default",
    });
    const found: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      // A hex colour, an rgb() or hsl() colour, or an inline style that
      // sets one. Hashes and IDs are longer than a colour and are not hit.
      const hits =
        source.match(
          /["'`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})["'`]|\b(?:rgb|rgba|hsl|hsla)\(|style=\{\{[^}]*(?:color|background)/g,
        ) ?? [];
      for (const hit of hits) {
        found.push(`${path}: ${hit}`);
      }
    }

    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(found).toEqual([]);
  });

  it("defines no dark colour scheme (light theme only)", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).toMatch(/color-scheme:\s*light/);
  });
});

function token(name: string): string {
  const value = tokens[name];
  if (value === undefined) {
    throw new Error(`Unknown token ${name}`);
  }
  return value;
}
