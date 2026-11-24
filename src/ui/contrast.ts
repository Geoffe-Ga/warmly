/**
 * WCAG contrast maths and the list of colour pairs the design system uses.
 *
 * The PRD's brand colours are references, not guaranteed-accessible text
 * colours (UI-001). Every text/background and UI/background combination used
 * in `styles.css` is listed here and checked by a unit test, so a token change
 * that breaks contrast fails the build.
 */

/** A foreground token and the background token it is drawn on. */
export type TokenPair = readonly [foreground: string, background: string];

/** Text pairs: must reach 4.5:1 (WCAG 2.2 AA, 1.4.3). */
export const TEXT_PAIRS: readonly TokenPair[] = [
  ["--color-ink", "--color-paper"],
  ["--color-ink", "--color-blush"],
  ["--color-ink", "--color-surface"],
  ["--color-ink-muted", "--color-paper"],
  ["--color-ink-muted", "--color-surface"],
  ["--color-coral-text", "--color-paper"],
  ["--color-coral-text", "--color-surface"],
  ["--color-coral-text", "--color-blush"],
  ["--color-on-strong", "--color-coral-strong"],
  ["--color-on-strong", "--color-danger"],
  ["--color-danger", "--color-paper"],
  ["--color-danger", "--color-surface"],
  ["--color-success", "--color-paper"],
  ["--color-ink", "--color-success-surface"],
  ["--color-ink", "--color-warning-surface"],
  ["--color-ink", "--color-danger-surface"],
];

/** Borders, focus rings and other non-text UI: must reach 3:1 (1.4.11). */
export const NON_TEXT_PAIRS: readonly TokenPair[] = [
  ["--color-border-strong", "--color-paper"],
  ["--color-border-strong", "--color-surface"],
  ["--color-focus", "--color-paper"],
  ["--color-focus", "--color-surface"],
  ["--color-focus", "--color-blush"],
  ["--color-danger", "--color-danger-surface"],
  ["--color-success", "--color-success-surface"],
  ["--color-warning", "--color-warning-surface"],
];

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];
  if (digits === undefined) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  const full =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join("")
      : digits;
  const weights = [0.2126, 0.7152, 0.0722];
  return weights.reduce((sum, weight, index) => {
    const start = index * 2;
    return (
      sum + weight * channel(Number.parseInt(full.slice(start, start + 2), 16))
    );
  }, 0);
}

/**
 * WCAG 2 contrast ratio between two colours.
 *
 * @param first - A `#rgb` or `#rrggbb` colour.
 * @param second - A `#rgb` or `#rrggbb` colour.
 * @returns A ratio from 1 (identical) to 21 (black on white).
 * @throws Error if either value is not a hex colour.
 */
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Read the custom properties declared in a stylesheet's `:root` block.
 *
 * @param css - Stylesheet text.
 * @returns Property names (with the leading `--`) mapped to lower-case values.
 * @throws Error if the stylesheet has no `:root` block.
 */
export function parseTokens(css: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
  if (root === undefined) {
    throw new Error("Stylesheet has no :root block");
  }
  const withoutComments = root.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens: Record<string, string> = {};
  for (const match of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    tokens[name] = value.trim().toLowerCase();
  }
  return tokens;
}
