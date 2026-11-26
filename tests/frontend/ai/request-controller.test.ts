/**
 * One shared behaviour for every AI request: failure, cancellation and
 * cost (PRD AI-014, AI-016, AI-017; AC-15, AC-03; invariant 2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { budgetFor, withinBudget } from "../../../src/ai/budget";
import {
  APP_MAX_INPUT_TOKENS,
  APP_MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
} from "../../../src/ai/config";
import { grantConsent } from "../../../src/ai/consent";
import { MalformedResponseError } from "../../../src/ai/contracts";
import {
  AI_ERROR_KINDS,
  AiError,
  classifyAiError,
  describeAiError,
  retryNote,
  type AiErrorKind,
} from "../../../src/ai/errors";
import { FakeProvider } from "../../../src/ai/fake-provider";
import {
  AiBusyError,
  AiGateway,
  ConsentRequiredError,
  NoProviderError,
  RequestTooLargeError,
} from "../../../src/ai/gateway";
import { UngroundedCitationError } from "../../../src/ai/grounding";
import { untilAborted } from "../../../src/ai/abort";
import type {
  AIProvider,
  ReflectRequest,
  SourceEntry,
} from "../../../src/ai/provider";
import { AiRequestController } from "../../../src/ai/request-controller";
import type { ReflectionAnswer } from "../../../src/ai/contracts";

const ENTRY: SourceEntry = {
  id: "00000000-0000-4000-8000-0000000000e1",
  contentHash: "a".repeat(64),
  responses: { good: "CANARY good", improve: "CANARY", loved: "CANARY" },
};

function request(question = "CANARY question"): ReflectRequest {
  return { kind: "reflect", question, entries: [ENTRY] };
}

/**
 * A provider that takes no notice of being told to stop: it answers only
 * when the test says so, however long ago the request was aborted.
 */
function deafProvider(): {
  gateway: AiGateway;
  answer: () => void;
  calls: () => number;
} {
  const base = new FakeProvider();
  const waiting: (() => void)[] = [];
  let calls = 0;
  const provider: AIProvider = {
    id: base.id,
    name: base.name,
    capabilities: () => base.capabilities(),
    validateConfig: () => base.validateConfig(),
    estimateTokens: (prompt) => base.estimateTokens(prompt),
    reflect: () => {
      calls += 1;
      return new Promise((resolve) => {
        waiting.push(() => {
          resolve({ markdown: "A late answer.", citations: [] });
        });
      });
    },
    generateCards: (prompt, signal) => base.generateCards(prompt, signal),
    generateSegmentAlternatives: (prompt, signal) =>
      base.generateSegmentAlternatives(prompt, signal),
  };
  return {
    gateway: new AiGateway(provider),
    answer: () => {
      for (const each of waiting.splice(0)) {
        each();
      }
    },
    calls: () => calls,
  };
}

function setUp(timeoutMs?: number): {
  provider: FakeProvider;
  gateway: AiGateway;
  controller: AiRequestController<ReflectRequest, ReflectionAnswer>;
  states: string[];
} {
  const provider = new FakeProvider();
  const gateway = new AiGateway(provider);
  const controller = new AiRequestController<ReflectRequest, ReflectionAnswer>(
    (asked, consent, signal) => gateway.reflect(asked, consent, signal),
    timeoutMs,
  );
  const states: string[] = [];
  controller.subscribe(() => {
    states.push(controller.state().phase);
  });
  return { provider, gateway, controller, states };
}

/** What the disclosure dialog's Send button does. */
function agree(
  controller: AiRequestController<ReflectRequest, ReflectionAnswer>,
): Promise<void> {
  const state = controller.state();
  if (state.phase !== "awaiting-consent") {
    throw new Error("the dialog is not open");
  }
  return controller.confirm(grantConsent(state.request));
}

/** Kinds a provider can fail with after the request has been sent. */
const SENT_FAILURES = AI_ERROR_KINDS.filter(
  (kind) => kind !== "cancelled" && kind !== "too_large" && kind !== "busy",
);

afterEach(() => {
  vi.useRealTimers();
});

describe("the phases of a request", () => {
  it("goes from asking, through consent and running, to a checked answer", async () => {
    const { controller, provider, states } = setUp();
    const asked = request();
    expect(controller.state()).toEqual({ phase: "idle" });

    controller.ask(asked);
    expect(controller.state()).toEqual({
      phase: "awaiting-consent",
      request: asked,
    });
    // Asking sends nothing.
    expect(provider.calls).toEqual([]);

    await agree(controller);

    const done = controller.state();
    expect(done.phase).toBe("done");
    expect(done.phase === "done" ? done.result.markdown : "").toBe(
      "A test answer about 1 entries. [c1]",
    );
    expect(states).toEqual(["awaiting-consent", "running", "done"]);
    expect(provider.calls).toHaveLength(1);
  });

  it("declining sends nothing, shows no error and keeps what was asked", () => {
    const { controller, provider } = setUp();
    const asked = request();
    controller.ask(asked);

    controller.decline();

    expect(controller.state()).toEqual({ phase: "idle" });
    expect(controller.inputs).toBe(asked);
    expect(provider.calls).toEqual([]);
  });

  it("ignores a confirmation when no dialog is open", async () => {
    const { controller, provider } = setUp();
    const asked = request();

    await controller.confirm(grantConsent(asked));

    expect(controller.state()).toEqual({ phase: "idle" });
    expect(provider.calls).toEqual([]);
  });

  it("ignores decline, cancel and retry in phases they do not belong to", async () => {
    const { controller } = setUp();

    controller.decline();
    controller.cancel();
    controller.retry();
    expect(controller.state()).toEqual({ phase: "idle" });

    controller.ask(request());
    await agree(controller);
    controller.decline();
    controller.retry();
    controller.cancel();
    expect(controller.state().phase).toBe("done");
  });

  it("a new question after an answer starts again and replaces what is kept", async () => {
    const { controller } = setUp();
    controller.ask(request("First"));
    await agree(controller);
    const second = request("Second");

    controller.ask(second);

    expect(controller.state()).toEqual({
      phase: "awaiting-consent",
      request: second,
    });
    expect(controller.inputs).toBe(second);
  });

  it("stops telling a listener that has stopped listening", () => {
    const { controller } = setUp();
    let told = 0;
    const stop = controller.subscribe(() => {
      told += 1;
    });

    controller.ask(request());
    stop();
    controller.decline();

    expect(told).toBe(1);
  });
});

describe("after a failure (AI-014, AC-15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it.each(SENT_FAILURES)(
    "after %s nothing is retried until the person asks (AC-15)",
    async (kind) => {
      const { controller, provider } = setUp();
      const asked = request();
      provider.failNextWith(kind);
      controller.ask(asked);

      await agree(controller);

      expect(controller.state()).toEqual({
        phase: "failed",
        request: asked,
        error: kind,
      });
      // Ten minutes pass with no one touching anything.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(provider.calls).toHaveLength(1);
      expect(controller.state().phase).toBe("failed");
      // What the person typed and chose is still there, unchanged.
      expect(controller.inputs).toBe(asked);
      expect(controller.inputs).toEqual(request());
    },
  );

  it.each(SENT_FAILURES)(
    "trying again after %s opens the dialog again and needs new consent",
    async (kind) => {
      const { controller, provider, gateway } = setUp();
      const asked = request();
      provider.failNextWith(kind);
      controller.ask(asked);
      const first = grantConsent(asked);
      await controller.confirm(first);

      controller.retry();

      // Back at the dialog: nothing has been sent a second time.
      expect(controller.state()).toEqual({
        phase: "awaiting-consent",
        request: asked,
      });
      expect(provider.calls).toHaveLength(1);
      // The consent given the first time is spent.
      await expect(gateway.reflect(asked, first)).rejects.toThrow(
        ConsentRequiredError,
      );
      await controller.confirm(first);
      expect(controller.state()).toMatchObject({ phase: "failed" });
      expect(provider.calls).toHaveLength(1);

      // New consent sends it once more, and this time it is answered.
      controller.retry();
      await agree(controller);
      expect(controller.state().phase).toBe("done");
      expect(provider.calls).toHaveLength(2);
    },
  );

  it("an answer that fails its checks is a failure like any other, and is not asked for again", async () => {
    const provider = new FakeProvider();
    provider.reflect = () =>
      Promise.resolve({ answer: "not in the agreed form" });
    const gateway = new AiGateway(provider);
    const controller = new AiRequestController<
      ReflectRequest,
      ReflectionAnswer
    >((asked, consent, signal) => gateway.reflect(asked, consent, signal));
    controller.ask(request());

    await agree(controller);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(controller.state()).toMatchObject({
      phase: "failed",
      error: "invalid_output",
    });
  });

  it("with no provider connected, says so and keeps the request", async () => {
    const gateway = new AiGateway(undefined);
    const controller = new AiRequestController<
      ReflectRequest,
      ReflectionAnswer
    >((asked, consent, signal) => gateway.reflect(asked, consent, signal));
    const asked = request();
    controller.ask(asked);

    await agree(controller);

    expect(controller.state()).toEqual({
      phase: "failed",
      request: asked,
      error: "no_credential",
    });
  });

  it("a request over the budget is refused before anything is sent", async () => {
    const { controller, provider } = setUp();
    const huge: ReflectRequest = {
      kind: "reflect",
      question: "Synthetic",
      entries: Array.from({ length: 400 }, (_, index) => ({
        ...ENTRY,
        id: `entry-${String(index)}`,
      })),
    };
    controller.ask(huge);

    await agree(controller);

    expect(controller.state()).toMatchObject({
      phase: "failed",
      error: "too_large",
    });
    expect(provider.calls).toEqual([]);
  });
});

describe("stopping a request (AI-016)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("Cancel aborts the request in flight and shows no error", async () => {
    const { controller, provider, states } = setUp();
    const asked = request();
    provider.hangNext();
    controller.ask(asked);
    const running = agree(controller);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state().phase).toBe("running");

    controller.cancel();
    await running;

    expect(controller.state()).toEqual({ phase: "idle" });
    expect(states).toEqual(["awaiting-consent", "running", "idle"]);
    expect(controller.inputs).toBe(asked);
    expect(provider.calls).toHaveLength(1);
  });

  it("a request cut off without the person or the time limit stopping it is shown as a failure", async () => {
    const { controller, provider } = setUp();
    const asked = request();
    provider.failNextWith("cancelled");
    controller.ask(asked);

    await agree(controller);

    // Not silently back to idle: the person asked and got nothing.
    expect(controller.state()).toEqual({
      phase: "failed",
      request: asked,
      error: "network",
    });
  });

  it("Cancel works at once even if the provider ignores it, and a late answer is dropped", async () => {
    const deaf = deafProvider();
    const controller = new AiRequestController<
      ReflectRequest,
      ReflectionAnswer
    >((asked, consent, signal) => deaf.gateway.reflect(asked, consent, signal));
    const asked = request();
    controller.ask(asked);
    const running = controller.confirm(grantConsent(asked));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state().phase).toBe("running");

    controller.cancel();
    await running;

    expect(controller.state()).toEqual({ phase: "idle" });
    // The provider answers long after it was told to stop.
    deaf.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state()).toEqual({ phase: "idle" });
    // The gateway is free: the next request is not refused as busy.
    const next = request("Next");
    controller.ask(next);
    const second = controller.confirm(grantConsent(next));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state().phase).toBe("running");
    controller.cancel();
    await second;
  });

  it("the time limit works even if the provider never answers or stops", async () => {
    const deaf = deafProvider();
    const controller = new AiRequestController<
      ReflectRequest,
      ReflectionAnswer
    >(
      (asked, consent, signal) => deaf.gateway.reflect(asked, consent, signal),
      5_000,
    );
    const asked = request();
    controller.ask(asked);
    const running = controller.confirm(grantConsent(asked));

    await vi.advanceTimersByTimeAsync(5_000);
    await running;

    expect(controller.state()).toEqual({
      phase: "failed",
      request: asked,
      error: "timeout",
    });
    expect(deaf.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(deaf.calls()).toBe(1);
  });

  it("stops waiting after the time limit, says it timed out, and sends nothing more", async () => {
    const { controller, provider } = setUp(5_000);
    const asked = request();
    provider.hangNext();
    controller.ask(asked);
    const running = agree(controller);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(controller.state().phase).toBe("running");
    await vi.advanceTimersByTimeAsync(1);
    await running;

    expect(controller.state()).toEqual({
      phase: "failed",
      request: asked,
      error: "timeout",
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(provider.calls).toHaveLength(1);
  });

  it("waits the app's standard time by default, and no timer is left after an answer", async () => {
    const { controller } = setUp();
    controller.ask(request());

    await agree(controller);

    expect(REQUEST_TIMEOUT_MS).toBe(90_000);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2);
    expect(controller.state().phase).toBe("done");
  });

  it("asking again while a request runs is ignored: one request at a time", async () => {
    const { controller, provider } = setUp();
    const first = request("First");
    provider.hangNext();
    controller.ask(first);
    const running = agree(controller);
    await vi.advanceTimersByTimeAsync(0);

    controller.ask(request("Second"));

    expect(controller.state()).toEqual({ phase: "running", request: first });
    expect(controller.inputs).toBe(first);
    controller.cancel();
    await running;
  });

  it("reset stops a running request, forgets the request and ignores a late answer", async () => {
    const { controller, provider } = setUp();
    provider.hangNext();
    controller.ask(request());
    const running = agree(controller);
    await vi.advanceTimersByTimeAsync(0);

    controller.reset();
    await running;

    expect(controller.state()).toEqual({ phase: "idle" });
    expect(controller.inputs).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an answer that arrives after a reset is not shown", async () => {
    let answer: (value: string) => void = () => undefined;
    const controller = new AiRequestController<ReflectRequest, string>(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const asked = request();
    controller.ask(asked);
    const running = controller.confirm(grantConsent(asked));

    controller.reset();
    answer("CANARY late answer");
    await running;

    expect(controller.state()).toEqual({ phase: "idle" });
  });

  it("a failure that arrives after a reset is not shown", async () => {
    let fail: (error: Error) => void = () => undefined;
    const controller = new AiRequestController<ReflectRequest, string>(
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const asked = request();
    controller.ask(asked);
    const running = controller.confirm(grantConsent(asked));

    controller.reset();
    fail(new AiError("network"));
    await running;

    expect(controller.state()).toEqual({ phase: "idle" });
  });
});

describe("the gateway runs one request at a time (AI-016)", () => {
  it("refuses a second call while one runs, without using up its consent", async () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const [first, second] = [request("First"), request("Second")];
    const stop = new AbortController();
    provider.hangNext();
    const running = gateway.reflect(first, grantConsent(first), stop.signal);
    const token = grantConsent(second);

    await expect(gateway.reflect(second, token)).rejects.toThrow(AiBusyError);

    stop.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    // The refused call's consent is still good once the first has ended.
    await gateway.reflect(second, token);
    expect(provider.calls).toHaveLength(2);
  });

  it("is free as soon as a call is stopped, whatever the provider does", async () => {
    const deaf = deafProvider();
    const first = request("First");
    const stop = new AbortController();
    const running = deaf.gateway.reflect(
      first,
      grantConsent(first),
      stop.signal,
    );

    stop.abort();

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    const second = request("Second");
    const next = new AbortController();
    const again = deaf.gateway.reflect(
      second,
      grantConsent(second),
      next.signal,
    );
    next.abort();
    await expect(again).rejects.toMatchObject({ name: "AbortError" });
    expect(deaf.calls()).toBe(2);
  });

  it("refuses a call that was stopped before it began, without using up its consent", async () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const asked = request();
    const token = grantConsent(asked);
    const stopped = new AbortController();
    stopped.abort();

    await expect(
      gateway.reflect(asked, token, stopped.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(provider.calls).toEqual([]);
    await expect(gateway.reflect(asked, token)).resolves.toBeDefined();
  });

  it("is free again after a call fails", async () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const first = request("First");
    provider.failNextWith("network");
    await expect(gateway.reflect(first, grantConsent(first))).rejects.toThrow(
      AiError,
    );

    const second = request("Second");
    await expect(
      gateway.reflect(second, grantConsent(second)),
    ).resolves.toBeDefined();
  });
});

describe("waiting no longer than a signal allows", () => {
  it("gives the result when the work finishes first", async () => {
    await expect(
      untilAborted(Promise.resolve("done"), new AbortController().signal),
    ).resolves.toBe("done");
  });

  it("gives the work's own failure when it fails first", async () => {
    await expect(
      untilAborted(
        Promise.reject(new AiError("network")),
        new AbortController().signal,
      ),
    ).rejects.toThrow(AiError);
  });

  it("ends at once when the signal fires, and drops what comes later", async () => {
    const stop = new AbortController();
    let finish: (value: string) => void = () => undefined;
    const work = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const waited = untilAborted(work, stop.signal);

    stop.abort();
    finish("too late");

    await expect(waited).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ends at once when the signal has already fired, and a later failure of the work is not left unhandled", async () => {
    const stop = new AbortController();
    stop.abort();

    await expect(
      untilAborted(Promise.reject(new Error("synthetic")), stop.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("the budget (AI-016)", () => {
  it("is the smaller of what the provider accepts and what the app allows", () => {
    expect(
      budgetFor({
        structuredOutput: true,
        cancellation: true,
        maxInputTokens: 8_000,
        maxOutputTokens: 1_000,
      }),
    ).toEqual({
      maxInputTokens: 8_000,
      maxOutputTokens: 1_000,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    expect(
      budgetFor({
        structuredOutput: true,
        cancellation: true,
        maxInputTokens: 1_000_000,
        maxOutputTokens: 128_000,
      }),
    ).toEqual({
      maxInputTokens: APP_MAX_INPUT_TOKENS,
      maxOutputTokens: APP_MAX_OUTPUT_TOKENS,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  });

  it.each([
    [0, true],
    [100, true],
    [101, false],
    [-1, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])("a request of %d tokens against a limit of 100: %s", (size, allowed) => {
    expect(
      withinBudget(size, {
        maxInputTokens: 100,
        maxOutputTokens: 10,
        timeoutMs: 1,
      }),
    ).toBe(allowed);
  });

  it("the gateway refuses a request the app's own limit forbids, even if the provider would take it", async () => {
    const provider = new FakeProvider();
    provider.capabilities = () => ({
      structuredOutput: true,
      cancellation: true,
      maxInputTokens: 10_000_000,
      maxOutputTokens: 128_000,
    });
    provider.estimateTokens = () => APP_MAX_INPUT_TOKENS + 1;
    const gateway = new AiGateway(provider);
    const asked = request();

    await expect(gateway.reflect(asked, grantConsent(asked))).rejects.toThrow(
      RequestTooLargeError,
    );
    expect(provider.calls).toEqual([]);
  });

  it("a request whose size cannot be worked out is not sent", async () => {
    const provider = new FakeProvider();
    provider.estimateTokens = () => Number.NaN;
    const gateway = new AiGateway(provider);
    const asked = request();

    await expect(gateway.reflect(asked, grantConsent(asked))).rejects.toThrow(
      RequestTooLargeError,
    );
    expect(provider.calls).toEqual([]);
  });
});

describe("naming a failure (AI-014)", () => {
  it.each([
    [new AiError("rate_limited"), "rate_limited"],
    [new AiError("invalid_credential"), "invalid_credential"],
    [new MalformedResponseError("answer"), "invalid_output"],
    [new UngroundedCitationError("quote_not_found"), "invalid_output"],
    [new NoProviderError(), "no_credential"],
    [new RequestTooLargeError(), "too_large"],
    [new AiBusyError(), "busy"],
    [new DOMException("stopped", "AbortError"), "cancelled"],
    [new DOMException("slow", "TimeoutError"), "timeout"],
    [new TypeError("Failed to fetch"), "network"],
    [new Error("CANARY anything else"), "provider_error"],
    ["a string", "provider_error"],
    [undefined, "provider_error"],
    [{ kind: "rate_limited" }, "provider_error"],
  ] as [unknown, AiErrorKind][])("%s is %s", (error, kind) => {
    expect(classifyAiError(error)).toBe(kind);
  });

  it("an error carries its kind and none of the provider's words", () => {
    const error = new AiError("provider_error");

    expect(error.kind).toBe("provider_error");
    expect(error.name).toBe("AiError");
    expect(error.message).toBe("The AI request failed (provider_error)");
  });
});

describe("what the person is told (AI-014, AI-017)", () => {
  const SHOWN = AI_ERROR_KINDS.filter((kind) => kind !== "cancelled");

  it.each(SHOWN)(
    "%s says what happened and what to do next, in sentences",
    (kind) => {
      const said = describeAiError(kind, "Example AI");

      for (const text of [said.happened, said.next]) {
        expect(text.length).toBeGreaterThan(20);
        expect(text).toMatch(/^[A-Z]/);
        expect(text).toMatch(/\.$/);
        // No codes, no jargon, no blame, no bare "error".
        expect(text).not.toMatch(
          /\b(4\d\d|5\d\d|HTTP|status|exception|invalid|token|null|undefined|oops|sorry|you must|error)\b/i,
        );
      }
      expect(said.next).toMatch(/try again|ask again/i);
    },
  );

  it("says something different for each kind", () => {
    const all = SHOWN.map(
      (kind) => describeAiError(kind, "Example AI").happened,
    );

    expect(new Set(all).size).toBe(SHOWN.length);
  });

  it("names the provider wherever the provider is the cause, and never Warmly's servers", () => {
    for (const kind of [
      "invalid_credential",
      "rate_limited",
      "timeout",
      "network",
      "provider_error",
      "invalid_output",
    ] as const) {
      expect(describeAiError(kind, "Example AI").happened).toContain(
        "Example AI",
      );
    }
    expect(
      SHOWN.map((kind) =>
        JSON.stringify(describeAiError(kind, "Example AI")),
      ).join(),
    ).not.toMatch(/our servers|Warmly's servers/);
  });

  it("is honest about a timeout: the provider may still have counted the request", () => {
    expect(describeAiError("timeout", "Example AI").happened).toMatch(
      /may still have received your request and counted it/,
    );
  });

  it("says with every failure that nothing was lost and that trying again sends the writing again", () => {
    const note = retryNote("Example AI");

    expect(note).toMatch(/Nothing you wrote or chose was lost/);
    expect(note).toMatch(/does not try again by itself/);
    expect(note).toMatch(/you will be asked first/);
    expect(note).toMatch(/sent to Example AI again/);
  });

  it("never offers another provider or an automatic retry", () => {
    const everything = [
      ...SHOWN.flatMap((kind) =>
        Object.values(describeAiError(kind, "Example AI")),
      ),
      retryNote("Example AI"),
    ].join(" ");

    expect(everything).not.toMatch(
      /another provider|different provider|automatically retry|will retry|retrying/i,
    );
  });
});
