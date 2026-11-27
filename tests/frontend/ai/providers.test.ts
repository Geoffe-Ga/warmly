/**
 * How each real AI provider is called, and what the person is told about
 * it (PRD SEC-008, AI-003, AI-004; ADR-0007).
 *
 * These values are a recorded decision. A test that fails here means the
 * decision is being changed: read the provider's documentation again,
 * and update ADR-0007 and the report with it.
 */
import { describe, expect, it } from "vitest";

import {
  APP_MAX_INPUT_TOKENS,
  APP_MAX_OUTPUT_TOKENS,
  PROVIDERS,
  PROVIDERS_CHECKED,
  PROVIDER_DISCLOSURE,
  type RealProviderId,
} from "../../../src/ai/config";
import { cspDirectives } from "../../../config/security-headers";

const IDS = Object.keys(PROVIDERS) as RealProviderId[];

describe("the providers the app can call", () => {
  it("are OpenAI and Anthropic, and no other", () => {
    expect(IDS.sort()).toEqual(["anthropic", "openai"]);
  });

  it("are called as ADR-0007 records", () => {
    expect(PROVIDERS.openai).toMatchObject({
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/responses",
      model: "gpt-6.2-sol",
      modelMaxInputTokens: 922_000,
      modelMaxOutputTokens: 128_000,
    });
    expect(PROVIDERS.anthropic).toMatchObject({
      name: "Anthropic",
      endpoint: "https://api.anthropic.com/v1/messages",
      model: "claude-opus-5-5",
      modelMaxInputTokens: 1_000_000,
      modelMaxOutputTokens: 128_000,
    });
    expect(PROVIDERS_CHECKED).toBe("2026-11-27");
  });

  it("tells OpenAI not to store the answer, on every request", () => {
    expect(PROVIDERS.openai.fixedBody).toEqual({ store: false });
  });

  it("sends Anthropic its version and its switch for browser requests", () => {
    expect(PROVIDERS.anthropic.fixedHeaders).toEqual({
      "anthropic-version": "2026-10-21",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it.each(IDS)(
    "%s is reached at one https origin, its endpoint's own",
    (id) => {
      const { origin, endpoint } = PROVIDERS[id];

      expect(new URL(endpoint).origin).toBe(origin);
      expect(origin.startsWith("https://")).toBe(true);
      // A bare origin, as the Content Security Policy needs it.
      expect(() => cspDirectives({ apiOrigin: origin })).not.toThrow();
    },
  );

  it.each(IDS)(
    "%s accepts more than the app will ever send or ask for",
    (id) => {
      // The app's own limits are what bound a request's cost (AI-016).
      expect(PROVIDERS[id].modelMaxInputTokens).toBeGreaterThan(
        APP_MAX_INPUT_TOKENS,
      );
      expect(PROVIDERS[id].modelMaxOutputTokens).toBeGreaterThan(
        APP_MAX_OUTPUT_TOKENS,
      );
    },
  );

  it.each(IDS)("%s has its terms, its usage policy and its data page", (id) => {
    for (const link of Object.values(PROVIDERS[id].links)) {
      expect(new URL(link).protocol).toBe("https:");
    }
    expect(Object.keys(PROVIDERS[id].links).sort()).toEqual([
      "dataHandling",
      "terms",
      "usagePolicy",
    ]);
  });
});

describe("what the person is told before their key is used", () => {
  it.each(IDS)("names %s and says the words go straight there", (id) => {
    const [first] = PROVIDER_DISCLOSURE[id];

    expect(first).toContain(`straight to ${PROVIDERS[id].name}`);
    expect(first).toContain("Warmly's servers never see them.");
  });

  it.each(IDS)("says %s may keep what is sent, and for how long", (id) => {
    const text = PROVIDER_DISCLOSURE[id].join(" ");

    expect(text).toMatch(/may keep/);
    expect(text).toMatch(/up to (30 days|2 years)/);
  });

  it.each(IDS)("says who pays %s, and asks for a limited key", (id) => {
    const text = PROVIDER_DISCLOSURE[id].join(" ");

    expect(text).toContain(`charged to your ${PROVIDERS[id].name} account`);
    expect(text).toContain("a key made only for Warmly");
    expect(text).toContain("spend limit");
  });

  it.each(IDS)(
    "says plainly that a browser cannot keep %s's key safe",
    (id) => {
      const text = PROVIDER_DISCLOSURE[id].join(" ");

      expect(text).toContain(
        "anything that can run in this page could read your key",
      );
      expect(text).toContain("A browser cannot keep it fully safe.");
    },
  );

  it.each(IDS)(
    "never calls the arrangement with %s secure or private",
    (id) => {
      const text = PROVIDER_DISCLOSURE[id].join(" ").toLowerCase();

      for (const word of ["secure", "private", "safe and", "guarantee"]) {
        expect(text).not.toContain(word);
      }
    },
  );

  it("is the provider's own claim where it speaks of training, not Warmly's", () => {
    expect(PROVIDER_DISCLOSURE.openai[1]).toMatch(/^OpenAI says /);
    expect(PROVIDER_DISCLOSURE.anthropic[1]).toMatch(/^Anthropic says /);
  });
});
