/**
 * The project's Playwright `test`. Every spec imports from here (ESLint
 * enforces it), which gives every test two automatic guards:
 *
 * - **Egress guard (PRD AC-03, SEC-007).** A request to any host outside the
 *   allowlist is aborted and fails the test. This is the standing mechanism
 *   behind "no AI call happened": a test does not have to look for a specific
 *   provider, because no unexpected host can be contacted at all.
 * - **CSP guard.** A Content Security Policy violation on any page fails the
 *   test.
 */
import { test as base, expect } from "@playwright/test";

/** Options a spec may override with `test.use`. */
export interface GuardOptions {
  /**
   * Hosts this test deliberately tries to reach and expects to be blocked.
   * Only the guard's own self-test sets this.
   */
  expectedBlockedHosts: readonly string[];
  /**
   * Whether this test deliberately violates the Content Security Policy.
   * A violation is reported once per policy (header and meta tag), so the
   * guard checks for presence, not a count.
   */
  expectCspViolation: boolean;
}

interface GuardFixtures {
  networkGuards: undefined;
}

const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

function allowedHosts(baseURL: string | undefined): ReadonlySet<string> {
  return new Set(baseURL === undefined ? [] : [new URL(baseURL).host]);
}

export const test = base.extend<GuardOptions & GuardFixtures>({
  expectedBlockedHosts: [[], { option: true }],
  expectCspViolation: [false, { option: true }],

  networkGuards: [
    async (
      { context, baseURL, expectedBlockedHosts, expectCspViolation },
      use,
    ) => {
      const allowed = allowedHosts(baseURL);
      const blocked: string[] = [];
      const violations: string[] = [];

      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (LOCAL_SCHEMES.has(url.protocol) || allowed.has(url.host)) {
          await route.continue();
          return;
        }
        blocked.push(url.host);
        await route.abort("blockedbyclient");
      });

      await context.exposeBinding(
        "__warmlyReportCspViolation",
        (_source, directive: string) => {
          violations.push(directive);
        },
      );
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const report = (
            globalThis as unknown as {
              __warmlyReportCspViolation?: (directive: string) => void;
            }
          ).__warmlyReportCspViolation;
          report?.(event.violatedDirective);
        });
      });

      await use(undefined);

      // Violation reports travel over an asynchronous channel. One more round
      // trip per open page guarantees every earlier report has arrived.
      for (const page of context.pages()) {
        await page.evaluate(() => undefined).catch(() => undefined);
      }

      expect(
        [...new Set(blocked)].sort(),
        "hosts contacted outside the egress allowlist",
      ).toEqual([...expectedBlockedHosts].sort());
      expect(
        violations.length > 0,
        `Content Security Policy violations: ${violations.join(", ") || "none"}`,
      ).toBe(expectCspViolation);
    },
    { auto: true },
  ],
});

export { expect };
