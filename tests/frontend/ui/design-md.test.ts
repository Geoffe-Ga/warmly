import { describe, expect, it } from "vitest";

import { parseTokens } from "../../../src/ui/contrast";
import css from "../../../src/styles.css?raw";
import design from "../../../DESIGN.md?raw";

/**
 * DESIGN.md describes the design system for people and design agents;
 * `src/styles.css` is the system itself. These tests fail when the two
 * disagree, so the document cannot quietly go stale.
 */

type Group = Record<string, string>;

/** The YAML front matter: the text between the first two `---` lines. */
function frontMatter(doc: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(doc);
  if (match?.[1] === undefined) {
    throw new Error("DESIGN.md has no front matter");
  }
  return match[1];
}

/** The indented lines under a top-level key such as `colors:`. */
function groupLines(front: string, group: string): string[] {
  const lines = front.split("\n");
  const start = lines.indexOf(`${group}:`);
  if (start === -1) {
    throw new Error(`Front matter has no ${group} group`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/** A flat group (`colors`, `spacing`, `rounded`) as name to value. */
function flatGroup(front: string, group: string): Group {
  const entries: Group = {};
  for (const line of groupLines(front, group)) {
    const match = /^ {2}([\w-]+): "?([^"]+)"?$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      entries[match[1]] = match[2].toLowerCase();
    }
  }
  return entries;
}

/** A nested group (`typography`, `components`) as name to its properties. */
function nestedGroup(front: string, group: string): Record<string, Group> {
  const entries: Record<string, Group> = {};
  let current: Group = {};
  for (const line of groupLines(front, group)) {
    const name = /^ {2}([\w-]+):$/.exec(line)?.[1];
    const property = /^ {4}([\w-]+): "?([^"]+)"?$/.exec(line);
    if (name !== undefined) {
      current = {};
      entries[name] = current;
    } else if (property?.[1] !== undefined && property[2] !== undefined) {
      current[property[1]] = property[2];
    }
  }
  return entries;
}

/** CSS tokens with the given prefix, keyed by the rest of the name. */
function cssGroup(prefix: string): Group {
  const entries: Group = {};
  for (const [name, value] of Object.entries(parseTokens(css))) {
    if (name.startsWith(prefix)) {
      entries[name.slice(prefix.length)] = value;
    }
  }
  return entries;
}

const front = frontMatter(design);
const body = design.slice(design.indexOf(front) + front.length);
const tokens = parseTokens(css);
const typography = nestedGroup(front, "typography");
const components = nestedGroup(front, "components");

const defined: Record<string, readonly string[]> = {
  colors: Object.keys(flatGroup(front, "colors")),
  spacing: Object.keys(flatGroup(front, "spacing")),
  rounded: Object.keys(flatGroup(front, "rounded")),
  typography: Object.keys(typography),
  component: Object.keys(components),
};

describe("DESIGN.md front matter", () => {
  it("names the system and declares the format version", () => {
    expect(front).toMatch(/^version: alpha$/m);
    expect(front).toMatch(/^name: Warmly$/m);
    expect(front).toMatch(/^description: \S/m);
  });

  it("lists exactly the colour tokens in styles.css, with the same values", () => {
    expect(flatGroup(front, "colors")).toEqual(cssGroup("--color-"));
  });

  it("lists the spacing scale in styles.css", () => {
    expect(flatGroup(front, "spacing")).toEqual({
      xs: tokens["--space-1"],
      sm: tokens["--space-2"],
      md: tokens["--space-3"],
      lg: tokens["--space-4"],
      xl: tokens["--space-5"],
    });
  });

  it("lists the radius scale in styles.css", () => {
    expect(flatGroup(front, "rounded")).toEqual({
      sm: tokens["--radius-small"],
      md: tokens["--radius"],
    });
  });

  it.each([
    ["heading", "--font-size-heading"],
    ["title", "--font-size-large"],
    ["body", "--font-size-body"],
    ["label", "--font-size-body"],
    ["small", "--font-size-small"],
    ["small-strong", "--font-size-small"],
    ["recovery-key", "--font-size-large"],
  ])("gives the %s type style the size of %s", (style, token) => {
    expect(typography[style]?.["fontSize"]).toBe(tokens[token]);
  });

  it("uses the body line height from styles.css", () => {
    expect(typography["body"]?.["lineHeight"]).toBe(tokens["--line-height"]);
  });

  it("describes a component for every variant the kit ships", () => {
    expect(Object.keys(components)).toEqual(
      expect.arrayContaining([
        "button-primary",
        "button-secondary",
        "button-danger",
        "button-disabled",
        "text-input",
        "text-input-invalid",
        "text-area",
        "card",
        "action-link",
        "banner-info",
        "banner-success",
        "banner-warning",
        "banner-error",
        "recovery-key",
        "dialog",
      ]),
    );
  });
});

describe("DESIGN.md token references", () => {
  const references = [...design.matchAll(/\{(\w+)\.([\w-]+)\}/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""] as const,
  );

  it("uses token references", () => {
    expect(references.length).toBeGreaterThan(50);
  });

  it("only refers to tokens and components that are defined", () => {
    const unknown = references
      .filter(([group, name]) => defined[group]?.includes(name) !== true)
      .map(([group, name]) => `{${group}.${name}}`);

    expect([...new Set(unknown)]).toEqual([]);
  });

  it("writes every hex colour in the prose as it is defined", () => {
    const known = new Set(Object.values(cssGroup("--color-")));
    const stray = (body.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter(
      (hex) => !known.has(hex.toLowerCase()),
    );

    expect(stray).toEqual([]);
  });
});

describe("DESIGN.md sections", () => {
  it.each([
    "Overview",
    "Colors",
    "Typography",
    "Layout",
    "Elevation & Depth",
    "Shapes",
    "Components",
    "Do's and Don'ts",
    "Responsive Behavior",
    "Iteration Guide",
    "Known Gaps",
  ])("has a %s section", (heading) => {
    expect(body.split("\n")).toContain(`## ${heading}`);
  });

  it("documents a light theme only (UI-001)", () => {
    expect(body).toMatch(/light[- ]only/i);
    expect(front).not.toMatch(/dark/i);
  });
});
