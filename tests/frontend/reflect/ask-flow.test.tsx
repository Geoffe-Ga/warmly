/**
 * The whole ask flow on the screen: follow-ups that carry only their own
 * session, failures that change nothing, and citations that open the entry
 * with the cited words marked (PRD RF-003, RF-005, RF-006, AI-014; AC-07,
 * AC-08, AC-26).
 */
import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SourceRef } from "../../../src/ai/contracts";
import { AI_ERROR_KINDS, type AiErrorKind } from "../../../src/ai/errors";
import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import type { AIProvider } from "../../../src/ai/provider";
import { dropSecrets } from "../../../src/app/SessionControls";
import { pathFor } from "../../../src/app/routes";
import type { JournalEntry } from "../../../src/domain/journal/types";
import { CitedPassage } from "../../../src/domain/reflect/passage";
import {
  PASSAGE_MARKED,
  PASSAGE_STALE,
  passageIn,
} from "../../../src/ui/screens/journal/Entry";
import { SESSION_TOO_LONG } from "../../../src/ui/screens/reflect/Session";
import {
  renderApp,
  testServices,
  visit,
  type TestServices,
} from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

const ENTRY: JournalEntry = {
  id: "00000000-0000-4000-8000-0000000000b1",
  createdAt: "2026-11-03T10:00:00.000Z",
  entryDate: { date: "2026-11-03", timeZone: "UTC" },
  updatedAt: "2026-11-03T10:00:00.000Z",
  status: "complete",
  responses: {
    good: "First line.\nWe cooked dinner together on Sunday.\nLast line.",
    improve: "I want to interrupt less.",
    loved: "They left a note in my bag.",
  },
  contentHash: "1".repeat(64),
};
const OTHER: JournalEntry = {
  ...ENTRY,
  id: "00000000-0000-4000-8000-0000000000b2",
  createdAt: "2026-11-10T10:00:00.000Z",
  entryDate: { date: "2026-11-10", timeZone: "UTC" },
  responses: { good: "Our walk was quiet.", improve: "x", loved: "y" },
  contentHash: "2".repeat(64),
};

const NEW = pathFor("reflect-session", { id: "new" });
const SEND = "Send to Test provider";
const BOX = /What would you like to ask about your journal/;

async function setUp(
  provider: AIProvider = new FakeProvider(),
): Promise<TestServices> {
  const base = testServices("unlocked");
  await base.records.put("journal-entry", ENTRY);
  await base.records.put("journal-entry", OTHER);
  return { ...base, ai: new AiGateway(provider) };
}

async function ask(question: string): Promise<void> {
  const user = userEvent.setup();
  const box = await screen.findByLabelText(BOX);
  await user.clear(box);
  await user.type(box, question);
  await user.click(screen.getByRole("button", { name: "Ask" }));
}

async function askAndSend(question: string): Promise<void> {
  await ask(question);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: SEND }));
}

/** A provider that answers as the stand-in does, with one thing changed. */
function providerWith(
  base: FakeProvider,
  reflect: AIProvider["reflect"],
): AIProvider {
  return {
    id: base.id,
    name: base.name,
    capabilities: () => base.capabilities(),
    validateConfig: () => base.validateConfig(),
    estimateTokens: (prompt) => base.estimateTokens(prompt),
    reflect,
    generateCards: (prompt, signal) => base.generateCards(prompt, signal),
    generateSegmentAlternatives: (prompt, signal) =>
      base.generateSegmentAlternatives(prompt, signal),
  };
}

describe("a follow-up question (RF-006, AC-08)", () => {
  it("says the earlier turns go too, and sends this session's turns with the question", async () => {
    const provider = new FakeProvider();
    const services = await setUp(provider);
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    await screen.findByRole("heading", { name: "Ask more" });
    const first = provider.calls[0];
    expect(first?.kind === "reflect" && first.history).toEqual([]);

    await ask("And what was hard?");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "2 journal entries, your question, and the earlier questions and answers in this reflection",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: SEND }));
    await waitFor(() => {
      expect(provider.calls).toHaveLength(2);
    });

    const second = provider.calls[1];
    expect(second?.kind === "reflect" && second.history).toEqual([
      {
        question: "What has gone well?",
        answer: expect.stringContaining(
          "A test answer about 2 entries.",
        ) as string,
      },
    ]);
    expect(second?.kind === "reflect" && second.question).toBe(
      "And what was hard?",
    );
  });

  it("a new reflection sends nothing from an earlier one", async () => {
    const provider = new FakeProvider();
    const services = await setUp(provider);
    await renderApp(NEW, services);
    await askAndSend("UNIQUE-MARKER first question");
    await screen.findByRole("heading", { name: "Ask more" });
    cleanup();

    await renderApp(NEW, services);
    await askAndSend("A different question");
    await waitFor(() => {
      expect(provider.calls).toHaveLength(2);
    });

    expect(JSON.stringify(provider.calls[1])).not.toContain("UNIQUE-MARKER");
    expect(provider.calls[1]).toMatchObject({ history: [] });
  });

  it("says so, and sends nothing, when the reflection is too long to add to", async () => {
    const provider = new FakeProvider();
    const services = await setUp(provider);
    const session = await services.reflect.start({
      question: "Why?",
      answer: {
        markdown: "Because. ".repeat(4000),
        citations: [],
        sources: [],
        coverage: {
          includedEntryIds: [],
          omittedEntryCount: 0,
          truncated: false,
        },
      },
    });
    await renderApp(pathFor("reflect-session", { id: session.id }), services);

    await ask("And?");

    expect((await screen.findByRole("alert")).textContent).toContain(
      SESSION_TOO_LONG,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(provider.calls).toEqual([]);
  });
});

describe("a failed request changes nothing (AI-014, RF-003)", () => {
  const kinds = AI_ERROR_KINDS.filter(
    (kind): kind is Exclude<AiErrorKind, "cancelled"> => kind !== "cancelled",
  );

  it.each(kinds)(
    "%s: the session is exactly as it was, the question is kept, and nothing is asked again",
    async (kind) => {
      const provider = new FakeProvider();
      const services = await setUp(provider);
      await renderApp(NEW, services);
      await askAndSend("What has gone well?");
      await screen.findByRole("heading", { name: "Ask more" });
      const before = await services.reflect.list();

      provider.failNextWith(kind);
      await askAndSend("And what was hard?");

      const alert = await screen.findByRole("alert");
      expect(
        within(alert).getByRole("button", { name: "Try again" }),
      ).toBeTruthy();
      expect(await services.reflect.list()).toEqual(before);
      expect(screen.getAllByRole("heading", { name: "Answer" })).toHaveLength(
        1,
      );
      expect(screen.getByLabelText(BOX)).toHaveProperty(
        "value",
        "And what was hard?",
      );
      // One attempt: no retry on its own.
      expect(provider.calls).toHaveLength(2);
    },
  );

  it("an answer that cites words that are not in the journal is discarded whole", async () => {
    const base = new FakeProvider();
    let calls = 0;
    const services = await setUp(
      providerWith(base, (prompt, signal) => {
        calls += 1;
        return calls === 1
          ? base.reflect(prompt, signal)
          : Promise.resolve({
              markdown: "CANARY made-up claim. [c1]",
              citations: [
                {
                  claimId: "c1",
                  evidence: [
                    { alias: "E1", key: "good", quote: "words never written" },
                  ],
                },
              ],
            });
      }),
    );
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    await screen.findByRole("heading", { name: "Ask more" });
    const before = await services.reflect.list();

    await askAndSend("And what was hard?");

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("button", { name: "Try again" }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("CANARY");
    expect(await services.reflect.list()).toEqual(before);
    expect(calls).toBe(2);
  });
});

describe("following a citation (RF-005, AC-07)", () => {
  it("opens the entry with the cited words marked, and puts nothing about them in the address", async () => {
    const services = await setUp();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    const answer = (
      await screen.findByRole("heading", { name: "Answer" })
    ).closest(".card") as HTMLElement;

    await userEvent.setup().click(
      within(answer).getAllByRole("link", {
        name: /^Source 1:/,
      })[0] as HTMLElement,
    );

    expect(await screen.findByText(PASSAGE_MARKED)).toBeTruthy();
    expect(window.location.pathname).toBe(
      pathFor("journal-entry", { id: ENTRY.id }),
    );
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    const marks = [...document.querySelectorAll("mark.cited-passage")];
    // The stand-in quotes the first 40 characters, which run over a line break.
    const quoted = ENTRY.responses.good.slice(0, 40).trim();
    expect(
      marks
        .map((mark) =>
          [...mark.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(""),
        )
        .join("\n"),
    ).toBe(quoted);
    expect(marks[0]?.textContent).toContain("Start of the cited words: ");
    expect(marks.at(-1)?.textContent).toContain(" End of the cited words.");
    // Only that answer is marked.
    for (const mark of marks) {
      expect(mark.closest(".card")?.textContent).toContain(
        "What's going well?",
      );
    }
  });

  it("says where the cited words start and end even when the range starts on a line break", async () => {
    const services = await setUp();
    const good = ENTRY.responses.good;
    const firstBreak = good.indexOf("\n");
    // From the line break itself to the end of the second line.
    services.passage.point({
      entryId: ENTRY.id,
      responseKey: "good",
      start: firstBreak,
      end: good.indexOf("\n", firstBreak + 1),
      sourceHash: ENTRY.contentHash,
    });

    await renderApp(pathFor("journal-entry", { id: ENTRY.id }), services);
    await screen.findByText(PASSAGE_MARKED);

    const marks = [...document.querySelectorAll("mark.cited-passage")];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe(
      "Start of the cited words: We cooked dinner together on Sunday. End of the cited words.",
    );
  });

  it("marks nothing when the entry is opened any other way, or opened again", async () => {
    const services = await setUp();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    const answer = (
      await screen.findByRole("heading", { name: "Answer" })
    ).closest(".card") as HTMLElement;
    await userEvent.setup().click(
      within(answer).getAllByRole("link", {
        name: /^Source 1:/,
      })[0] as HTMLElement,
    );
    await screen.findByText(PASSAGE_MARKED);
    cleanup();

    await renderApp(pathFor("journal-entry", { id: ENTRY.id }), services);
    await screen.findByText("I want to interrupt less.");

    expect(document.querySelector("mark")).toBeNull();
    expect(screen.queryByText(PASSAGE_MARKED)).toBeNull();
    expect(screen.queryByText(PASSAGE_STALE)).toBeNull();
  });

  it("marks nothing, and says why, when the entry has changed since the answer", async () => {
    const services = await setUp();
    services.passage.point({
      entryId: ENTRY.id,
      responseKey: "good",
      start: 0,
      end: 5,
      sourceHash: "9".repeat(64),
    });

    await renderApp(pathFor("journal-entry", { id: ENTRY.id }), services);

    expect(await screen.findByText(PASSAGE_STALE)).toBeTruthy();
    expect(document.querySelector("mark")).toBeNull();
  });

  it("forgets the passage when the app locks", async () => {
    const services = await setUp();
    services.passage.point({
      entryId: ENTRY.id,
      responseKey: "good",
      start: 0,
      end: 5,
      sourceHash: ENTRY.contentHash,
    });

    dropSecrets(services);

    expect(services.passage.take(ENTRY.id)).toBeUndefined();
  });
});

describe("the passage holder", () => {
  const ref: SourceRef = {
    entryId: "e1",
    responseKey: "loved",
    start: 2,
    end: 6,
    sourceHash: "h",
  };

  it("hands a passage over once, and only to the entry it is in", () => {
    const passage = new CitedPassage();

    passage.point(ref);
    expect(passage.take("e1")).toEqual(ref);
    expect(passage.take("e1")).toBeUndefined();

    passage.point(ref);
    expect(passage.take("another")).toBeUndefined();
    // Asking for the wrong entry uses it up too: it was for one step only.
    expect(passage.take("e1")).toBeUndefined();
  });

  it("keeps only the last passage pointed at", () => {
    const passage = new CitedPassage();

    passage.point(ref);
    passage.point({ ...ref, entryId: "e2" });

    expect(passage.take("e2")).toMatchObject({ entryId: "e2" });
  });
});

describe("where to mark (AC-26)", () => {
  const cited: SourceRef = {
    entryId: ENTRY.id,
    responseKey: "improve",
    start: 2,
    end: 6,
    sourceHash: ENTRY.contentHash,
  };

  it("is the cited range when the entry is the text the answer was given", () => {
    expect(passageIn(ENTRY, cited)).toEqual({
      key: "improve",
      start: 2,
      end: 6,
    });
    expect(
      passageIn(ENTRY, {
        ...cited,
        start: 0,
        end: ENTRY.responses.improve.length,
      }),
    ).toEqual({
      key: "improve",
      start: 0,
      end: ENTRY.responses.improve.length,
    });
  });

  it.each([
    ["no citation", undefined],
    ["a different hash", { ...cited, sourceHash: "0".repeat(64) }],
    ["a range that starts before the text", { ...cited, start: -1 }],
    ["an empty range", { ...cited, start: 6, end: 6 }],
    ["a backwards range", { ...cited, start: 7, end: 6 }],
    [
      "a range that runs past the end",
      { ...cited, end: ENTRY.responses.improve.length + 1 },
    ],
  ])("is nothing for %s", (_name, ref) => {
    expect(passageIn(ENTRY, ref)).toBeUndefined();
  });
});
