/**
 * Reflect against the stand-in provider and in-memory sessions (PRD
 * RF-001, RF-002, RF-003, RF-005; AC-03, AC-07, AC-23).
 */
import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { dropSecrets } from "../../../src/app/SessionControls";
import { pathFor } from "../../../src/app/routes";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  InvalidQuestionError,
  MAX_QUESTION,
  reflectRequest,
} from "../../../src/domain/reflect/request";
import { MemoryReflectSessions } from "../../../src/domain/reflect/sessions";
import { firstQuestion } from "../../../src/domain/reflect/types";
import { SOURCE_CHANGED } from "../../../src/ui/components/CitedAnswer";
import {
  NOTHING_TO_ASK_ABOUT,
  QUESTION_NEEDED,
} from "../../../src/ui/screens/reflect/Session";
import {
  heading,
  renderApp,
  testServices,
  visit,
  type TestServices,
} from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

function entry(
  number: number,
  date: string,
  changes: Partial<JournalEntry> = {},
): JournalEntry {
  return {
    id: `00000000-0000-4000-8000-0000000000a${String(number)}`,
    createdAt: `${date}T10:00:00.000Z`,
    entryDate: { date, timeZone: "UTC" },
    updatedAt: `${date}T10:00:00.000Z`,
    status: "complete",
    responses: {
      good: `We cooked together ${String(number)}.`,
      improve: `Improve ${String(number)}`,
      loved: `Loved ${String(number)}`,
    },
    contentHash: String(number).repeat(64),
    ...changes,
  };
}

const FIRST = entry(1, "2026-11-03");
const SECOND = entry(2, "2026-11-10");
const DRAFT = entry(3, "2026-11-12", {
  status: "draft",
  responses: { good: "CANARY half a thought", improve: "", loved: "" },
});

async function setUp(
  entries: readonly JournalEntry[] = [SECOND, FIRST, DRAFT],
): Promise<{ services: TestServices; provider: FakeProvider }> {
  const provider = new FakeProvider();
  const base = testServices("unlocked");
  for (const one of entries) {
    await base.records.put("journal-entry", one);
  }
  return { services: { ...base, ai: new AiGateway(provider) }, provider };
}

const NEW = pathFor("reflect-session", { id: "new" });
const SEND = "Send to Test provider";
const BOX = /What would you like to ask about your journal/;

async function ask(question: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(BOX), question);
  await user.click(screen.getByRole("button", { name: "Ask" }));
}

async function askAndSend(question: string): Promise<void> {
  await ask(question);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: SEND }));
}

describe("the Reflect landing page (RF-001, RF-002)", () => {
  it("offers Ask a question, the saved reflections and the journal, and calls no provider", async () => {
    const { services, provider } = await setUp();
    await renderApp("/reflect", services);

    expect(heading().textContent).toBe("Reflect");
    expect(
      screen.getByRole("link", { name: "Ask a question" }).getAttribute("href"),
    ).toBe(NEW);
    expect(screen.getByText("You have no saved reflections yet.")).toBeTruthy();
    const entries = await screen.findByRole("navigation", { name: "Entries" });
    expect(within(entries).getAllByRole("link")).toHaveLength(2);
    expect(provider.calls).toEqual([]);
  });

  it("searches the journal like the journal screen does, without calling a provider", async () => {
    const { services, provider } = await setUp();
    await renderApp("/reflect", services);
    await screen.findByRole("navigation", { name: "Entries" });

    await userEvent
      .setup()
      .type(screen.getByLabelText(/Search your journal/), "together 2");

    await waitFor(() => {
      expect(
        within(
          screen.getByRole("navigation", { name: "Entries" }),
        ).getAllByRole("link"),
      ).toHaveLength(1);
    });
    expect(provider.calls).toEqual([]);
    expect(window.location.search).toBe("");
  });

  it("offers no suggested or canned questions", async () => {
    const { services } = await setUp();
    await renderApp("/reflect", services);
    await screen.findByRole("navigation", { name: "Entries" });

    const main = document.querySelector("main") as HTMLElement;
    expect(within(main).queryByRole("button")).toBeNull();
    expect(main.textContent).not.toMatch(/try asking|for example|suggest/i);
  });

  it("opening Reflect and a saved session calls no provider (RF-001, AC-03)", async () => {
    const { services, provider } = await setUp();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    await screen.findByRole("heading", { name: "Answer" });
    const made = provider.calls.length;
    const user = userEvent.setup();

    await user.click(screen.getByRole("link", { name: "Back to Reflect" }));
    await user.click(
      await screen.findByRole("link", { name: /session from/i }),
    );
    await screen.findByRole("heading", { name: "Answer" });

    expect(made).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("lists a saved reflection by its day and first question", async () => {
    const { services } = await setUp();
    await services.reflect.start(
      {
        question: "What has gone well?",
        answer: {
          markdown: "Plenty.",
          citations: [],
          sources: [],
          coverage: {
            includedEntryIds: [],
            omittedEntryCount: 0,
            truncated: false,
          },
        },
      },
      new Date("2026-11-20T09:00:00.000Z"),
    );
    await renderApp("/reflect", services);

    const link = await screen.findByRole("link", { name: /Session from/ });
    expect(link.textContent).toBe(
      "Session from 20 November 2026What has gone well?",
    );
  });
});

describe("asking a question (RF-002, RF-003, SEC-009)", () => {
  it("a new reflection opens empty, with the person's own question box, and sends nothing", async () => {
    const { services, provider } = await setUp();
    await renderApp(NEW, services);

    expect(heading().textContent).toBe("Reflection");
    expect(await screen.findByLabelText(BOX)).toHaveProperty("value", "");
    expect(screen.queryByRole("heading", { name: "Answer" })).toBeNull();
    expect(provider.calls).toEqual([]);
    expect(await services.reflect.list()).toEqual([]);
  });

  it("pressing Ask opens the disclosure and still sends nothing", async () => {
    const { services, provider } = await setUp();
    await renderApp(NEW, services);

    await ask("What has gone well?");

    const dialog = await screen.findByRole("alertdialog");
    // Two finished entries; the draft is not counted and not sent.
    expect(dialog.textContent).toContain("2 journal entries and your question");
    expect(provider.calls).toEqual([]);
  });

  it("Don't send keeps the question in the box and stores nothing", async () => {
    const { services, provider } = await setUp();
    await renderApp(NEW, services);
    await ask("What has gone well?");

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Don't send" }));

    expect(screen.getByLabelText(BOX)).toHaveProperty(
      "value",
      "What has gone well?",
    );
    expect(provider.calls).toEqual([]);
    expect(await services.reflect.list()).toEqual([]);
  });

  it("after agreeing, sends the finished entries once, oldest first, with no draft and no IDs", async () => {
    const { services, provider } = await setUp();
    await renderApp(NEW, services);

    await askAndSend("  What has gone well?  ");
    await screen.findByRole("heading", { name: "Answer" });

    expect(provider.calls).toEqual([
      {
        kind: "reflect",
        question: "What has gone well?",
        sources: [
          { alias: "E1", responses: FIRST.responses },
          { alias: "E2", responses: SECOND.responses },
        ],
      },
    ]);
    expect(JSON.stringify(provider.calls)).not.toContain("CANARY");
  });

  it("shows the question and the answer, stores the reflection and moves to its own address", async () => {
    const { services } = await setUp();
    await renderApp(NEW, services);

    await askAndSend("What has gone well?");

    const answer = (
      await screen.findByRole("heading", { name: "Answer" })
    ).closest(".card") as HTMLElement;
    expect(
      within(
        screen
          .getByRole("heading", { name: "You asked" })
          .closest(".card") as HTMLElement,
      ).getByText("What has gone well?"),
    ).toBeTruthy();
    expect(answer.textContent).toContain("A test answer about 2 entries.");
    const [stored] = await services.reflect.list();
    expect(stored === undefined ? "" : firstQuestion(stored)).toBe(
      "What has gone well?",
    );
    expect(window.location.pathname).toBe(
      pathFor("reflect-session", { id: stored?.id ?? "" }),
    );
    // The answer records every entry it was built from, with its hash
    // then, so a later change to any of them can be found (DEP-002).
    const kept = stored?.messages[1];
    expect(kept?.role === "answer" ? kept.answer.sources : []).toEqual([
      { entryId: FIRST.id, sourceHash: FIRST.contentHash },
      { entryId: SECOND.id, sourceHash: SECOND.contentHash },
    ]);
    // The address holds an ID, never the question.
    expect(window.location.href).not.toMatch(/gone|well/);
    expect(screen.getByLabelText(BOX)).toHaveProperty("value", "");
  });

  it("a follow-up is its own request, asked and agreed to again, in the same reflection", async () => {
    const { services, provider } = await setUp();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    await screen.findByRole("heading", { name: "Ask more" });

    await ask("And what was hard?");
    // Nothing more is sent until the person agrees again.
    await screen.findByRole("alertdialog");
    expect(provider.calls).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Answer" })).toHaveLength(
        2,
      );
    });
    expect(provider.calls).toHaveLength(2);
    expect(await services.reflect.list()).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "You asked" })).toHaveLength(
      2,
    );
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])(
    "asks for a question when the box is %s, and opens no dialog",
    async (_name, typed) => {
      const { services, provider } = await setUp();
      await renderApp(NEW, services);
      const user = userEvent.setup();
      if (typed !== "") {
        await user.type(await screen.findByLabelText(BOX), typed);
      }

      await user.click(await screen.findByRole("button", { name: "Ask" }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        QUESTION_NEEDED,
      );
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(provider.calls).toEqual([]);
    },
  );

  it("says there is nothing to ask about when no entry is finished", async () => {
    const { services, provider } = await setUp([DRAFT]);
    await renderApp(NEW, services);

    await ask("What has gone well?");

    expect((await screen.findByRole("alert")).textContent).toContain(
      NOTHING_TO_ASK_ABOUT,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(provider.calls).toEqual([]);
  });

  it("keeps the question after a failure, and Try again asks for consent again", async () => {
    const { services, provider } = await setUp();
    provider.failNextWith("network");
    await renderApp(NEW, services);
    const user = userEvent.setup();

    await askAndSend("What has gone well?");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Warmly couldn't reach Test provider.");
    expect(screen.getByLabelText(BOX)).toHaveProperty(
      "value",
      "What has gone well?",
    );
    expect(await services.reflect.list()).toEqual([]);

    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await user.click(await screen.findByRole("button", { name: SEND }));

    await screen.findByRole("heading", { name: "Answer" });
    expect(provider.calls).toHaveLength(2);
  });

  it("a request that is cancelled stores nothing and keeps the question", async () => {
    const { services, provider } = await setUp();
    provider.hangNext();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText(/Waiting for Test provider/)).toBeNull();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText(BOX)).toHaveProperty(
      "value",
      "What has gone well?",
    );
    expect(await services.reflect.list()).toEqual([]);
  });
});

describe("a reflection whose entry has changed (DEP-003; engine in #51)", () => {
  // The engine that deletes such a reflection is issue #51. Until it
  // lands, this is what protects the person: the reflection is still
  // listed, but it never shows the entry's old words or its new ones as
  // if they had been cited. When #51 lands, the first expectation changes
  // to "the reflection is gone".
  it("is still here until the invalidation engine lands, and shows none of the entry's words as cited", async () => {
    const { services } = await setUp();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    await screen.findByRole("heading", { name: "Answer" });
    const [stored] = await services.reflect.list();
    cleanup();

    await services.records.put("journal-entry", {
      ...FIRST,
      responses: { ...FIRST.responses, good: "Rewritten since." },
      contentHash: "9".repeat(64),
      updatedAt: "2026-11-20T10:00:00.000Z",
    });
    await renderApp(
      pathFor("reflect-session", { id: stored?.id ?? "" }),
      services,
    );
    const answer = (
      await screen.findByRole("heading", { name: "Answer" })
    ).closest(".card") as HTMLElement;

    expect(await services.reflect.list()).toHaveLength(1);
    expect(answer.textContent).toContain(SOURCE_CHANGED);
    expect(answer.textContent).not.toContain("We cooked together 1.");
    expect(answer.textContent).not.toContain("Rewritten since.");
  });
});

describe("a saved reflection (RF-001, RF-006)", () => {
  it("says so when it is not here, and offers the way back", async () => {
    const { services, provider } = await setUp();
    await renderApp(pathFor("reflect-session", { id: "sample-1" }), services);

    await screen.findByText(/This reflection isn't on this device/);
    expect(screen.queryByLabelText(BOX)).toBeNull();
    expect(provider.calls).toEqual([]);
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Back to Reflect" }));
    expect(heading().textContent).toBe("Reflect");
  });

  it("is forgotten when the app locks, with everything else decrypted", async () => {
    const { services } = await setUp();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    await screen.findByRole("heading", { name: "Answer" });
    expect(await services.reflect.list()).toHaveLength(1);

    dropSecrets(services);

    expect(await services.reflect.list()).toEqual([]);
  });
});

describe("the request for a question (RF-003, RF-004)", () => {
  it("is fresh copies of the finished entries, oldest first, with nothing else about them", () => {
    const request = reflectRequest(" Why? ", [SECOND, DRAFT, FIRST]);

    expect(request).toEqual({
      kind: "reflect",
      question: "Why?",
      entries: [
        {
          id: FIRST.id,
          contentHash: FIRST.contentHash,
          responses: FIRST.responses,
        },
        {
          id: SECOND.id,
          contentHash: SECOND.contentHash,
          responses: SECOND.responses,
        },
      ],
    });
    // Copies: sealing the request must not freeze a stored record.
    expect(request.entries[0]?.responses).not.toBe(FIRST.responses);
    Object.freeze(request.entries[0]?.responses);
    expect(Object.isFrozen(FIRST.responses)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["only spaces", " \n "],
    ["too long", "q".repeat(MAX_QUESTION + 1)],
  ])("refuses a question that is %s", (_name, question) => {
    expect(() => reflectRequest(question, [FIRST])).toThrow(
      InvalidQuestionError,
    );
  });

  it("accepts a question of exactly the longest length, counting an emoji as one", () => {
    expect(
      reflectRequest("🙂".repeat(MAX_QUESTION), [FIRST]).question,
    ).toHaveLength(MAX_QUESTION * 2);
  });

  it("orders entries of the same day by when they were written, then by ID", () => {
    const a = entry(5, "2026-11-10", { createdAt: "2026-11-10T08:00:00.000Z" });
    const b = entry(4, "2026-11-10", { createdAt: "2026-11-10T08:00:00.000Z" });
    const c = entry(6, "2026-11-10", { createdAt: "2026-11-10T07:00:00.000Z" });

    expect(
      reflectRequest("Why?", [a, b, c]).entries.map((each) => each.id),
    ).toEqual([c.id, b.id, a.id]);
  });
});

describe("sessions held in memory (RF-006)", () => {
  const ANSWER = {
    markdown: "Synthetic.",
    citations: [],
    sources: [],
    coverage: { includedEntryIds: [], omittedEntryCount: 0, truncated: false },
  };

  it("lists newest first, finds by ID, and tells listeners of changes", async () => {
    const sessions = new MemoryReflectSessions();
    let told = 0;
    const stop = sessions.subscribe(() => {
      told += 1;
    });
    const older = await sessions.start(
      { question: "First?", answer: ANSWER },
      new Date("2026-11-01T09:00:00.000Z"),
    );
    const newer = await sessions.start(
      { question: "Second?", answer: ANSWER },
      new Date("2026-11-02T09:00:00.000Z"),
    );

    expect((await sessions.list()).map((each) => each.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(await sessions.get(older.id)).toEqual(older);
    expect(await sessions.get("nope")).toBeUndefined();
    expect(told).toBe(2);
    stop();
    await sessions.start({ question: "Third?", answer: ANSWER });
    expect(told).toBe(2);
  });

  it("adds a question and its answer to an active session, and to no other", async () => {
    const sessions = new MemoryReflectSessions();
    const made = await sessions.start(
      { question: "First?", answer: ANSWER },
      new Date("2026-11-01T09:00:00.000Z"),
    );

    const added = await sessions.add(
      made.id,
      { question: "More?", answer: ANSWER },
      new Date("2026-11-01T10:00:00.000Z"),
    );

    expect(added?.messages.map((each) => each.role)).toEqual([
      "question",
      "answer",
      "question",
      "answer",
    ]);
    expect(added?.createdAt).toBe("2026-11-01T09:00:00.000Z");
    expect(added?.updatedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(firstQuestion(added ?? made)).toBe("First?");
    expect(
      await sessions.add("nope", { question: "?", answer: ANSWER }),
    ).toBeUndefined();
  });

  it("the first question of a session with none is empty", () => {
    expect(
      firstQuestion({
        id: "s",
        status: "active",
        messages: [],
        createdAt: "",
        updatedAt: "",
      }),
    ).toBe("");
  });

  it("forgets everything on lock", async () => {
    const sessions = new MemoryReflectSessions();
    await sessions.start({ question: "First?", answer: ANSWER });

    sessions.lock();

    expect(await sessions.list()).toEqual([]);
  });
});
