import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeConsent, grantConsent } from "../../../src/ai/consent";
import {
  FAKE_PROVIDER_MARK,
  FakeProvider,
} from "../../../src/ai/fake-provider";
import {
  AiGateway,
  ConsentRequiredError,
  LARGE_REQUEST_TOKENS,
  NoProviderError,
  RequestTooLargeError,
  createGateway,
} from "../../../src/ai/gateway";
import type {
  AIProvider,
  CardsRequest,
  ReflectRequest,
  SegmentAlternativesRequest,
  SourceEntry,
} from "../../../src/ai/provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

const ENTRY: SourceEntry = {
  id: "00000000-0000-4000-8000-0000000000e1",
  contentHash: "a".repeat(64),
  responses: {
    good: "CANARY good",
    improve: "CANARY improve",
    loved: "CANARY loved",
  },
};

function reflect(question = "Synthetic question"): ReflectRequest {
  return { kind: "reflect", question, entries: [ENTRY] };
}

const CARDS: CardsRequest = {
  kind: "cards",
  topic: "Synthetic topic",
  entries: [ENTRY],
};
const SEGMENT: SegmentAlternativesRequest = {
  kind: "segment-alternatives",
  text: "Synthetic wording",
  entries: [ENTRY],
};

function connected(): { gateway: AiGateway; provider: FakeProvider } {
  const provider = new FakeProvider();
  return { gateway: new AiGateway(provider), provider };
}

describe("no consent, no call (SEC-009, invariant 2)", () => {
  it("refuses to call a provider without a fresh consent token", async () => {
    const { gateway, provider } = connected();
    const request = reflect();

    await expect(gateway.reflect(request, undefined as never)).rejects.toThrow(
      ConsentRequiredError,
    );
    const token = grantConsent(request);
    await gateway.reflect(request, token);
    await expect(gateway.reflect(request, token)).rejects.toThrow(
      ConsentRequiredError,
    );

    // The provider was reached exactly once.
    expect(provider.calls).toEqual([request]);
  });

  it("a token for one request cannot authorise another, even one that looks the same", async () => {
    const { gateway, provider } = connected();
    const [shown, other, twin] = [reflect("A"), reflect("B"), reflect("A")];

    await expect(gateway.reflect(other, grantConsent(shown))).rejects.toThrow(
      ConsentRequiredError,
    );
    await expect(gateway.reflect(twin, grantConsent(shown))).rejects.toThrow(
      ConsentRequiredError,
    );

    expect(provider.calls).toEqual([]);
  });

  it("a token is used up by the attempt it was refused for", async () => {
    const { gateway, provider } = connected();
    const [shown, other] = [reflect("A"), reflect("B")];
    const token = grantConsent(shown);
    await expect(gateway.reflect(other, token)).rejects.toThrow(
      ConsentRequiredError,
    );

    // Offering it again, now with the right request, does not work either.
    await expect(gateway.reflect(shown, token)).rejects.toThrow(
      ConsentRequiredError,
    );
    expect(provider.calls).toEqual([]);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["true", true],
    ["a word", "yes"],
    ["an empty object", {}],
    ["a frozen empty object", Object.freeze({})],
    ["a copy of a real token", { ...grantConsent(reflect()) }],
  ])("does not accept %s as consent", async (_name, forged) => {
    const { gateway, provider } = connected();

    await expect(gateway.reflect(reflect(), forged as never)).rejects.toThrow(
      ConsentRequiredError,
    );
    expect(provider.calls).toEqual([]);
  });

  it("asks for consent on every kind of call", async () => {
    const { gateway, provider } = connected();

    await expect(
      gateway.generateCards(CARDS, undefined as never),
    ).rejects.toThrow(ConsentRequiredError);
    await expect(
      gateway.generateSegmentAlternatives(SEGMENT, undefined as never),
    ).rejects.toThrow(ConsentRequiredError);
    expect(provider.calls).toEqual([]);

    await gateway.generateCards(CARDS, grantConsent(CARDS));
    await gateway.generateSegmentAlternatives(SEGMENT, grantConsent(SEGMENT));
    expect(provider.calls).toEqual([CARDS, SEGMENT]);
  });

  it("a token for one kind of call does not work for another", async () => {
    const { gateway, provider } = connected();

    await expect(
      gateway.generateCards(CARDS, grantConsent(reflect())),
    ).rejects.toThrow(ConsentRequiredError);
    expect(provider.calls).toEqual([]);
  });

  it("the token registry gives nothing away: consuming twice fails the second time", () => {
    const request = reflect();
    const token = grantConsent(request);

    expect(consumeConsent(token, request)).toBe(true);
    expect(consumeConsent(token, request)).toBe(false);
  });
});

describe("one attempt, no retry, no other provider (AI-014, invariant 2)", () => {
  function failing(): AIProvider & { attempts: number } {
    const base = new FakeProvider();
    const made = {
      id: base.id,
      name: base.name,
      attempts: 0,
      capabilities: () => base.capabilities(),
      validateConfig: () => base.validateConfig(),
      estimateTokens: (request: ReflectRequest) => base.estimateTokens(request),
      reflect: () => {
        made.attempts += 1;
        return Promise.reject(new Error("synthetic provider failure"));
      },
      generateCards: () => Promise.reject(new Error("unused")),
      generateSegmentAlternatives: () => Promise.reject(new Error("unused")),
    };
    return made as AIProvider & { attempts: number };
  }

  it("a failed call is not tried again, and asking again needs new consent", async () => {
    const provider = failing();
    const gateway = new AiGateway(provider);
    const request = reflect();
    const token = grantConsent(request);

    await expect(gateway.reflect(request, token)).rejects.toThrow(
      "synthetic provider failure",
    );
    expect(provider.attempts).toBe(1);

    await expect(gateway.reflect(request, token)).rejects.toThrow(
      ConsentRequiredError,
    );
    expect(provider.attempts).toBe(1);
  });

  it("passes the provider's answer back unchanged, to be checked by the caller", async () => {
    const { gateway } = connected();
    const request = reflect();

    const answer = await gateway.reflect(request, grantConsent(request));

    expect(answer).toEqual({
      answer: "A test answer about 1 entries.",
      sources: [{ entryId: ENTRY.id, sourceHash: ENTRY.contentHash }],
    });
  });

  it("passes a cancellation on to the provider", async () => {
    const { gateway, provider } = connected();
    const request = reflect();
    const cancel = new AbortController();
    cancel.abort();

    await expect(
      gateway.reflect(request, grantConsent(request), cancel.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.calls).toEqual([]);
  });

  it("refuses a request larger than the provider accepts, before sending anything", async () => {
    const { gateway, provider } = connected();
    const huge: ReflectRequest = {
      kind: "reflect",
      question: "Synthetic",
      entries: Array.from({ length: 400 }, () => ENTRY),
    };

    await expect(gateway.reflect(huge, grantConsent(huge))).rejects.toThrow(
      RequestTooLargeError,
    );
    expect(provider.calls).toEqual([]);
  });
});

describe("with no provider connected (AI-001)", () => {
  it("says so, checks as not configured, and can send nothing", async () => {
    const gateway = new AiGateway(undefined);
    const request = reflect();

    expect(gateway.state()).toEqual({ kind: "none" });
    expect(await gateway.validateConfig()).toEqual({
      ok: false,
      reason: "no_credential",
    });
    expect(() => gateway.disclose(request)).toThrow(NoProviderError);
    await expect(
      gateway.reflect(request, grantConsent(request)),
    ).rejects.toThrow(NoProviderError);
  });

  it("a production build starts with no provider, and other builds with the stand-in", () => {
    expect(createGateway().state()).toEqual({
      kind: "connected",
      name: "Test provider",
      standIn: true,
    });

    vi.stubEnv("MODE", "production");
    expect(createGateway().state()).toEqual({ kind: "none" });
  });
});

describe("what the person is shown before agreeing (AI-015, AI-016)", () => {
  it("names the provider, counts the entries and says what else is sent", () => {
    const { gateway } = connected();

    expect(gateway.disclose(reflect())).toMatchObject({
      provider: "Test provider",
      entries: 1,
      also: "your question",
      large: false,
    });
    expect(gateway.disclose(CARDS).also).toBe("your topic");
    expect(gateway.disclose(SEGMENT).also).toBe("the wording you chose");
  });

  it("carries no journal text: only names, counts and sizes", () => {
    const { gateway } = connected();

    expect(
      JSON.stringify(gateway.disclose(reflect("CANARY question"))),
    ).not.toContain("CANARY");
  });

  it("points out a large request", () => {
    const { gateway } = connected();
    const large: ReflectRequest = {
      kind: "reflect",
      question: "Synthetic",
      entries: Array.from({ length: 80 }, () => ENTRY),
    };

    const disclosure = gateway.disclose(large);

    expect(disclosure.estimatedTokens).toBeGreaterThanOrEqual(
      LARGE_REQUEST_TOKENS,
    );
    expect(disclosure.large).toBe(true);
  });

  it("describing a request seals it, so what is described is what is sent (SEC-009)", () => {
    const { gateway } = connected();
    const request = {
      kind: "reflect" as const,
      question: "Synthetic question",
      entries: [{ ...ENTRY, responses: { ...ENTRY.responses } }],
    };

    gateway.disclose(request);

    expect(() => {
      request.question = "Another question";
    }).toThrow(TypeError);
    expect(() => {
      request.entries.push(ENTRY);
    }).toThrow(TypeError);
    expect(() => {
      (request.entries[0] as SourceEntry as { id: string }).id = "other";
    }).toThrow(TypeError);
    expect(() => {
      (request.entries[0]?.responses as { good: string }).good = "Changed";
    }).toThrow(TypeError);
  });

  it("seals what a request holds even if the request itself was already frozen", () => {
    const { gateway } = connected();
    const entry = { ...ENTRY, responses: { ...ENTRY.responses } };
    const entries = [entry];
    const request = Object.freeze({
      kind: "reflect" as const,
      question: "Synthetic question",
      entries,
    });

    gateway.disclose(request);

    expect(() => {
      entries.push(ENTRY);
    }).toThrow(TypeError);
    expect(() => {
      entry.responses.good = "Changed";
    }).toThrow(TypeError);
  });

  it("seals a request that refers to itself without looping", () => {
    const request: ReflectRequest & { self?: unknown } = {
      kind: "reflect",
      question: "Synthetic question",
      entries: [],
    };
    request.self = request;

    expect(Object.isFrozen(grantConsent(request))).toBe(true);
    expect(Object.isFrozen(request.entries)).toBe(true);
  });

  it("a request cannot be changed between agreeing and sending", async () => {
    const { gateway, provider } = connected();
    const request = {
      kind: "reflect" as const,
      question: "Synthetic question",
      entries: [{ ...ENTRY, responses: { ...ENTRY.responses } }],
    };
    const before = structuredClone(request);
    const token = grantConsent(request);

    expect(() => {
      request.question = "Send everything instead";
    }).toThrow(TypeError);
    expect(() => {
      request.entries.push({ ...ENTRY, id: "smuggled" });
    }).toThrow(TypeError);
    await gateway.reflect(request, token);

    expect(provider.calls).toEqual([before]);
  });

  it("describing a request sends nothing and uses no consent", () => {
    const { gateway, provider } = connected();
    const request = reflect();
    const token = grantConsent(request);

    gateway.disclose(request);
    gateway.disclose(request);

    expect(provider.calls).toEqual([]);
    expect(consumeConsent(token, request)).toBe(true);
  });
});

describe("the stand-in provider (AI-001)", () => {
  it("is marked as a stand-in, so a production build can be checked for it", () => {
    expect(new FakeProvider().mark).toBe(FAKE_PROVIDER_MARK);
    expect(FAKE_PROVIDER_MARK).toMatch(/^warmly\.fake\./);
  });

  it("is ready without a key and says what it can do", async () => {
    const provider = new FakeProvider();

    expect(await provider.validateConfig()).toEqual({ ok: true });
    expect(provider.capabilities()).toEqual({
      structuredOutput: true,
      cancellation: true,
      maxInputTokens: 8_000,
      maxOutputTokens: 1_000,
    });
  });

  it("answers the same way every time, citing only what it was sent", async () => {
    const provider = new FakeProvider();
    const signal = new AbortController().signal;

    const first = await provider.generateCards(CARDS, signal);
    const second = await provider.generateCards(CARDS, signal);
    const alternatives = await provider.generateSegmentAlternatives(
      SEGMENT,
      signal,
    );

    expect(second).toEqual(first);
    expect(first).toEqual({
      cards: [
        {
          text: "A test card.",
          sources: [{ entryId: ENTRY.id, sourceHash: ENTRY.contentHash }],
        },
      ],
    });
    expect(alternatives).toEqual({
      alternatives: ["A test alternative.", "Another test alternative."],
    });
    expect(JSON.stringify([first, alternatives])).not.toContain("CANARY");
  });

  it("estimates more tokens for more text, and never none", () => {
    const provider = new FakeProvider();
    const small = provider.estimateTokens({
      kind: "reflect",
      question: "",
      entries: [],
    });
    const larger = provider.estimateTokens(reflect());

    expect(small).toBeGreaterThan(0);
    expect(larger).toBeGreaterThan(small);
  });

  it("stops every kind of call when cancelled", async () => {
    const provider = new FakeProvider();
    const cancel = new AbortController();
    cancel.abort();

    await expect(
      provider.reflect(reflect(), cancel.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      provider.generateCards(CARDS, cancel.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      provider.generateSegmentAlternatives(SEGMENT, cancel.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.calls).toEqual([]);
  });
});
