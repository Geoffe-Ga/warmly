import { cleanup, render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway, ConsentRequiredError } from "../../../src/ai/gateway";
import type { Disclosure } from "../../../src/ai/gateway";
import type {
  AIProvider,
  ReflectRequest,
  SourceEntry,
} from "../../../src/ai/provider";
import { ServicesProvider } from "../../../src/app/services";
import {
  AiDisclosureDialog,
  CANNOT_DESCRIBE,
  NOT_EVERYTHING,
  describeSent,
  tooLongNote,
} from "../../../src/ui/components/AiDisclosureDialog";
import { NO_PROVIDER } from "../../../src/ui/screens/settings/AiProvider";
import { renderApp, testServices } from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function entries(count: number): SourceEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${String(index)}`,
    contentHash: "a".repeat(64),
    responses: { good: "CANARY good", improve: "CANARY", loved: "CANARY" },
  }));
}

function request(count = 14): ReflectRequest {
  return {
    kind: "reflect",
    question: "CANARY question",
    entries: entries(count),
  };
}

const DISCLOSURE: Disclosure = {
  provider: "Example AI",
  entries: 14,
  omitted: 0,
  tooLong: 0,
  after: 0,
  afterOmitted: 0,
  afterTooLong: 0,
  earlierTurns: 0,
  also: "your question",
  estimatedTokens: 900,
  large: false,
};

/** A provider called "Example AI" that says a request is as big as it is told. */
function exampleAi(tokens = 900): AIProvider {
  const base = new FakeProvider();
  return {
    id: base.id,
    name: "Example AI",
    capabilities: () => base.capabilities(),
    validateConfig: () => base.validateConfig(),
    estimateTokens: () => tokens,
    reflect: (asked, signal) => base.reflect(asked, signal),
    generateCards: (asked, signal) => base.generateCards(asked, signal),
    generateSegmentAlternatives: (asked, signal) =>
      base.generateSegmentAlternatives(asked, signal),
  };
}

function open(
  options: {
    readonly gateway?: AiGateway;
    readonly request?: ReflectRequest;
    readonly open?: boolean;
  } = {},
): {
  confirmed: ReturnType<typeof vi.fn>;
  cancelled: ReturnType<typeof vi.fn>;
  request: ReflectRequest;
} {
  const confirmed = vi.fn();
  const cancelled = vi.fn();
  const asked = options.request ?? request();
  const services = {
    ...testServices("unlocked"),
    ai: options.gateway ?? new AiGateway(exampleAi()),
  };
  render(
    <ServicesProvider value={services}>
      <AiDisclosureDialog
        open={options.open ?? true}
        request={asked}
        onConfirm={confirmed}
        onCancel={cancelled}
      />
    </ServicesProvider>,
  );
  return { confirmed, cancelled, request: asked };
}

describe("what a request sends, in words (AI-015)", () => {
  it.each([
    [0, "your question", "no journal entries and your question"],
    [1, "your topic", "1 journal entry and your topic"],
    [14, "your question", "14 journal entries and your question"],
    [3, "the wording you chose", "3 journal entries and the wording you chose"],
  ] as const)("%i entries with %s", (entries, also, text) => {
    expect(describeSent({ ...DISCLOSURE, entries, also })).toBe(text);
  });

  it("says that a follow-up sends the reflection's earlier turns too (RF-006)", () => {
    expect(describeSent({ ...DISCLOSURE, earlierTurns: 2 })).toBe(
      "14 journal entries, your question, and the earlier questions and answers in this reflection",
    );
    expect(
      describeSent({ ...DISCLOSURE, entries: 3, omitted: 7, earlierTurns: 1 }),
    ).toBe(
      "3 of your 10 journal entries, your question, and the earlier questions and answers in this reflection",
    );
  });

  it("says how many of how many when some entries do not fit (RF-004)", () => {
    expect(describeSent({ ...DISCLOSURE, entries: 140, omitted: 4860 })).toBe(
      "140 of your 5,000 journal entries and your question",
    );
    expect(describeSent({ ...DISCLOSURE, entries: 1, omitted: 1 })).toBe(
      "1 of your 2 journal entries and your question",
    );
  });
});

describe("the disclosure before anything is sent (SEC-009, AI-015)", () => {
  it("says who it goes to, what is sent, that it is a third party, and that a key does not mean nothing is kept", () => {
    open();

    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByRole("heading").textContent).toBe(
      "Send this to Example AI?",
    );
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toContain("14 journal entries and your question");
    expect(text).toContain("as readable text");
    expect(text).toContain("Example AI is a separate company");
    expect(text).toContain("under its terms and privacy policy, not Warmly's");
    expect(text).toContain("does not mean Example AI keeps nothing");
    expect(text).toContain("you are asked again each time");
  });

  it("shows nothing of what the person wrote", () => {
    open();

    expect(screen.getByRole("alertdialog").textContent).not.toContain("CANARY");
  });

  it("points out a large request and its cost, only when it is one (AI-016)", () => {
    open({ gateway: new AiGateway(exampleAi(5_200)) });
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "large request (about 5,200 tokens), which costs more",
    );
    cleanup();

    open();
    expect(screen.getByRole("alertdialog").textContent).not.toContain("large");
  });

  it("says that not everything is sent, only when entries were left out (RF-004, AC-09)", () => {
    open({
      request: {
        ...request(),
        coverage: { omittedEntryCount: 986, truncated: true },
      },
    });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "This sends 14 of your 1,000 journal entries and your question to Example AI",
    );
    expect(dialog.textContent).toContain(NOT_EVERYTHING);
    cleanup();

    open();
    expect(screen.getByRole("alertdialog").textContent).not.toContain(
      NOT_EVERYTHING,
    );
  });

  it("says when entries are too long to send, apart from those that did not fit", () => {
    open({
      request: {
        ...request(),
        coverage: { omittedEntryCount: 3, truncated: true, tooLong: 2 },
      },
    });
    const both = screen.getByRole("alertdialog").textContent;
    expect(both).toContain(tooLongNote(2));
    expect(both).toContain(NOT_EVERYTHING);
    cleanup();

    open({
      request: {
        ...request(),
        coverage: { omittedEntryCount: 1, truncated: true, tooLong: 1 },
      },
    });
    const only = screen.getByRole("alertdialog").textContent;
    expect(only).toContain(tooLongNote(1));
    expect(only).not.toContain(NOT_EVERYTHING);
    expect(tooLongNote(1)).toMatch(
      /^1 entry is too long .* so it is left out\./,
    );
    expect(tooLongNote(1200)).toMatch(
      /^1,200 entries are too long .* so they are left out\./,
    );
  });

  it("counts nothing as left out for a request that is not a question", () => {
    const gateway = new AiGateway(exampleAi());

    expect(
      gateway.disclose({ kind: "cards", topic: "Synthetic", entries: [] })
        .omitted,
    ).toBe(0);
  });

  it("starts on the choice that sends nothing", () => {
    open();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Don't send" }),
    );
  });

  it("sends nothing and makes no consent when cancelled, by button or by Escape", async () => {
    const { confirmed, cancelled } = open();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Don't send" }));
    await user.keyboard("{Escape}");

    expect(cancelled).toHaveBeenCalledTimes(2);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("is not shown at all when closed, and describes nothing", () => {
    const provider = exampleAi();
    const estimate = vi.spyOn(provider, "estimateTokens");
    open({ gateway: new AiGateway(provider), open: false });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(estimate).not.toHaveBeenCalled();
  });

  it.each([
    ["no provider is connected", () => new AiGateway(undefined)],
    [
      "the provider cannot size the request",
      () => {
        const provider = exampleAi();
        provider.estimateTokens = () => {
          throw new Error("synthetic CANARY failure");
        };
        return new AiGateway(provider);
      },
    ],
  ])("offers nothing to agree to when %s (SEC-009)", async (_name, make) => {
    const { confirmed, cancelled } = open({ gateway: make() });

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("This can't be sent");
    expect(dialog.textContent).toContain(CANNOT_DESCRIBE);
    expect(dialog.textContent).not.toContain("CANARY");
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Close" }));

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("makes one consent however many times Send is pressed, and a fresh one the next time it is shown", async () => {
    const services = {
      ...testServices("unlocked"),
      ai: new AiGateway(exampleAi()),
    };
    const asked = request(2);
    const confirmed = vi.fn();
    const view = (shown: boolean) => (
      <ServicesProvider value={services}>
        <AiDisclosureDialog
          open={shown}
          request={asked}
          onConfirm={confirmed}
          onCancel={vi.fn()}
        />
      </ServicesProvider>
    );
    const user = userEvent.setup();
    // The screen is slow to close the dialog: it stays open after Send.
    const { rerender } = render(view(true));
    const send = screen.getByRole("button", { name: "Send to Example AI" });

    await user.click(send);
    await user.click(send);
    await user.dblClick(send);
    expect(confirmed).toHaveBeenCalledTimes(1);

    rerender(view(false));
    rerender(view(true));
    await user.click(
      screen.getByRole("button", { name: "Send to Example AI" }),
    );
    expect(confirmed).toHaveBeenCalledTimes(2);
    expect(confirmed.mock.calls[1]?.[0]).not.toBe(confirmed.mock.calls[0]?.[0]);
  });

  it("sizes a request once while it is shown, not on every render", () => {
    const provider = exampleAi();
    const estimate = vi.spyOn(provider, "estimateTokens");
    const services = {
      ...testServices("unlocked"),
      ai: new AiGateway(provider),
    };
    const asked = request(2);
    const view = (
      <ServicesProvider value={services}>
        <AiDisclosureDialog
          open
          request={asked}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </ServicesProvider>
    );

    const { rerender } = render(view);
    rerender(view);
    rerender(view);

    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it("describes the very request it asks about, whatever the screen might have said (SEC-009)", () => {
    open({ request: request(3) });
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "3 journal entries and your question",
    );
    cleanup();

    open({ request: request(1) });
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "1 journal entry and your question",
    );
  });

  it("the request cannot be changed once it has been shown", () => {
    const { request: shown } = open({ request: request(2) });
    const loose = shown as unknown as {
      question: string;
      entries: { responses: { good: string } }[];
    };

    expect(() => {
      loose.question = "Something else";
    }).toThrow(TypeError);
    expect(() => {
      loose.entries.push(loose.entries[0] as never);
    }).toThrow(TypeError);
    expect(() => {
      (loose.entries[0] as { responses: { good: string } }).responses.good =
        "Something else";
    }).toThrow(TypeError);
    expect(shown.question).toBe("CANARY question");
    expect(shown.entries).toHaveLength(2);
  });

  it("agreeing gives consent that sends this request once, and no other", async () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const { confirmed, request: shown } = open({ gateway });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send to Test provider" }));

    expect(confirmed).toHaveBeenCalledTimes(1);
    const consent = confirmed.mock.calls[0]?.[0] as never;
    const other: ReflectRequest = { ...shown };
    await expect(gateway.reflect(other, consent)).rejects.toThrow(
      ConsentRequiredError,
    );
    expect(provider.calls).toEqual([]);
  });

  it("the consent from the dialog lets the gateway send exactly what was shown", async () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const { confirmed, request: shown } = open({ gateway });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send to Test provider" }));
    const consent = confirmed.mock.calls[0]?.[0] as never;

    await gateway.reflect(shown, consent);
    await expect(gateway.reflect(shown, consent)).rejects.toThrow(
      ConsentRequiredError,
    );

    // The provider gets the question and the entries under request-only
    // names, with no entry ID or hash (ADR-0008).
    expect(provider.calls).toEqual([
      {
        kind: "reflect",
        question: shown.question,
        sources: shown.entries.map((entry, index) => ({
          alias: `E${String(index + 1)}`,
          responses: entry.responses,
        })),
        history: [],
        partial: false,
      },
    ]);
  });
});

describe("the AI provider on the Settings screen (AI-001, AC-23)", () => {
  it("says no provider is connected in a production build, and that Warmly works without one", async () => {
    vi.stubEnv("MODE", "production");
    const services = testServices("unlocked");

    await renderApp("/settings", services);

    const card = within(
      (await screen.findByRole("heading", { name: "AI provider" })).closest(
        ".card",
      ) as HTMLElement,
    );
    expect(card.getByText(NO_PROVIDER)).toBeTruthy();
    expect(card.getByText(/Warmly works without one/)).toBeTruthy();
    // Encrypted copies are also kept on the server, so it does not say
    // that writing stays on the device.
    expect(card.getByText(/only you can read it/)).toBeTruthy();
    expect(screen.queryByText(/stays? on your devices?/)).toBeNull();
    expect(card.getByText(/only ever happens when you ask/)).toBeTruthy();
  });

  it("names the stand-in outside production and says it sends nothing", async () => {
    await renderApp("/settings", testServices("unlocked"));

    const heading = await screen.findByRole("heading", { name: "AI provider" });
    const text = heading.closest(".card")?.textContent ?? "";
    expect(text).toContain("Connected: Test provider");
    expect(text).toContain("it sends nothing anywhere");
    expect(text).not.toContain(NO_PROVIDER);
  });

  it("opening Settings makes no AI call", async () => {
    const provider = new FakeProvider();
    const services = {
      ...testServices("unlocked"),
      ai: new AiGateway(provider),
    };

    await renderApp("/settings", services);
    await screen.findByRole("heading", { name: "AI provider" });

    expect(provider.calls).toEqual([]);
  });
});
