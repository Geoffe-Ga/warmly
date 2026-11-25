/**
 * Reflect against the stand-in provider and in-memory sessions (PRD
 * RF-001, RF-002, RF-003, RF-005; AC-03, AC-07, AC-23).
 */
import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  SOURCE_CHANGED,
  SOURCE_GONE,
} from "../../../src/ui/components/CitedAnswer";
import {
  RecordReflectSessions,
  SessionFinishedError,
} from "../../../src/domain/reflect/sessions";
import {
  firstQuestion,
  isReflectSession,
} from "../../../src/domain/reflect/types";
import { MemoryRecordStore } from "../../../src/storage/record-store";
import {
  ANSWER_NOT_SAVED,
  FINISHED,
  FINISH_EXPLAINED,
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
      "Session from 20 November 2026What has gone well?Open",
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

describe("a saved reflection while the journal is still loading", () => {
  it("shows no answer, and never says an entry is gone, until the journal has loaded", async () => {
    const { services } = await setUp();
    await renderApp(NEW, services);
    await askAndSend("What has gone well?");
    await screen.findByRole("heading", { name: "Answer" });
    const [stored] = await services.reflect.list();
    cleanup();
    // The journal takes its time; everything else answers at once.
    const list = services.records.list.bind(services.records);
    let open: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });
    vi.spyOn(services.records, "list").mockImplementation(async (kind) => {
      if (kind === "journal-entry") {
        await held;
      }
      return list(kind);
    });

    await renderApp(
      pathFor("reflect-session", { id: stored?.id ?? "" }),
      services,
    );
    await screen.findByText("Getting your reflection.");

    expect(screen.queryByRole("heading", { name: "Answer" })).toBeNull();
    expect(screen.queryByText(SOURCE_GONE)).toBeNull();

    open();
    const answer = (
      await screen.findByRole("heading", { name: "Answer" })
    ).closest(".card") as HTMLElement;
    expect(answer.textContent).toContain("We cooked together 1.");
    expect(screen.queryByText(SOURCE_GONE)).toBeNull();
    expect(screen.queryByText("Getting your reflection.")).toBeNull();
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

  it("is dropped from memory when the app locks, with everything else decrypted", async () => {
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

describe("sessions kept as private records (RF-006)", () => {
  const ANSWER = {
    markdown: "Synthetic.",
    citations: [],
    sources: [],
    coverage: { includedEntryIds: [], omittedEntryCount: 0, truncated: false },
  };

  it("lists newest first, finds by ID, and tells listeners of changes", async () => {
    const sessions = new RecordReflectSessions(new MemoryRecordStore());
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
    const sessions = new RecordReflectSessions(new MemoryRecordStore());
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
});

const SAVED_ANSWER = {
  markdown: "Synthetic saved answer.",
  citations: [],
  sources: [],
  coverage: { includedEntryIds: [], omittedEntryCount: 0, truncated: false },
};

describe("the life of a session (RF-007, RF-008, AC-08)", () => {
  async function made() {
    const records = new MemoryRecordStore();
    const sessions = new RecordReflectSessions(records);
    const session = await sessions.start(
      { question: "First?", answer: SAVED_ANSWER },
      new Date("2026-11-01T09:00:00.000Z"),
    );
    return { records, sessions, session };
  }

  it("starts active and is stored as one record holding every turn", async () => {
    const { records, session } = await made();

    expect(session.status).toBe("active");
    expect(await records.list("reflect-session")).toEqual([session]);
    expect(isReflectSession(session)).toBe(true);
  });

  it("a finished session is read-only and finishing adds nothing to it (RF-007, AC-08)", async () => {
    const { sessions, session } = await made();

    const finished = await sessions.finish(
      session.id,
      new Date("2026-11-02T09:00:00.000Z"),
    );

    expect(finished).toEqual({
      ...session,
      status: "finished",
      updatedAt: "2026-11-02T09:00:00.000Z",
    });
    await expect(
      sessions.add(session.id, { question: "One more?", answer: SAVED_ANSWER }),
    ).rejects.toThrow(SessionFinishedError);
    expect((await sessions.get(session.id))?.messages).toHaveLength(2);
  });

  it("there is no way back from finished: finishing again changes nothing", async () => {
    const { records, sessions, session } = await made();
    const first = await sessions.finish(
      session.id,
      new Date("2026-11-02T09:00:00.000Z"),
    );
    let writes = 0;
    const put = records.put.bind(records);
    records.put = (kind, record) => {
      writes += 1;
      return put(kind, record);
    };

    const again = await sessions.finish(
      session.id,
      new Date("2026-11-03T09:00:00.000Z"),
    );

    expect(again).toEqual(first);
    expect(writes).toBe(0);
    // Nothing in the interface makes a session active again.
    expect(
      Object.getOwnPropertyNames(RecordReflectSessions.prototype).sort(),
    ).toEqual([
      "add",
      "constructor",
      "finish",
      "get",
      "list",
      "remove",
      "start",
      "subscribe",
    ]);
  });

  it("finishing or removing a session that is not here does nothing", async () => {
    const { sessions } = await made();

    expect(await sessions.finish("nope")).toBeUndefined();
    expect(await sessions.remove("nope")).toBe(false);
    expect(await sessions.list()).toHaveLength(1);
  });

  it("removes a session and everything in it with one deletion", async () => {
    const { records, sessions, session } = await made();
    await sessions.add(session.id, { question: "More?", answer: SAVED_ANSWER });

    expect(await sessions.remove(session.id)).toBe(true);

    expect(await sessions.list()).toEqual([]);
    expect(await records.list("reflect-session")).toEqual([]);
  });

  it("a session left for 90 days is still active and can be added to (RF-007)", async () => {
    const { sessions, session } = await made();
    const later = new Date("2026-11-01T09:00:00.000Z");
    later.setUTCDate(later.getUTCDate() + 90);

    const added = await sessions.add(
      session.id,
      { question: "Still here?", answer: SAVED_ANSWER },
      later,
    );

    expect(added?.status).toBe("active");
    expect(added?.messages).toHaveLength(4);
    expect(added?.updatedAt).toBe("2027-01-30T09:00:00.000Z");
  });

  it.each([
    ["nothing", undefined],
    ["a list", []],
    [
      "no ID",
      { status: "active", messages: [], createdAt: "a", updatedAt: "b" },
    ],
    [
      "an unknown status",
      {
        id: "s",
        status: "paused",
        messages: [],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "messages that are not a list",
      {
        id: "s",
        status: "active",
        messages: "x",
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "a turn with an unknown role",
      {
        id: "s",
        status: "active",
        messages: [{ id: "m", role: "system", at: "t", text: "x" }],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "a question with no text",
      {
        id: "s",
        status: "active",
        messages: [{ id: "m", role: "question", at: "t" }],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "an answer with no coverage",
      {
        id: "s",
        status: "active",
        messages: [
          {
            id: "m",
            role: "answer",
            at: "t",
            answer: { markdown: "x", citations: [] },
          },
        ],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "an answer that does not say which entries it was built from",
      {
        id: "s",
        status: "active",
        messages: [
          {
            id: "m",
            role: "answer",
            at: "t",
            answer: {
              markdown: "x",
              citations: [],
              coverage: SAVED_ANSWER.coverage,
            },
          },
        ],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "a sent entry with no hash",
      {
        id: "s",
        status: "active",
        messages: [
          {
            id: "m",
            role: "answer",
            at: "t",
            answer: { ...SAVED_ANSWER, sources: [{ entryId: "e" }] },
          },
        ],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "a citation holding journal text instead of a reference",
      {
        id: "s",
        status: "active",
        messages: [
          {
            id: "m",
            role: "answer",
            at: "t",
            answer: {
              ...SAVED_ANSWER,
              citations: [{ claimId: "c1", evidence: [{ quote: "words" }] }],
            },
          },
        ],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
    [
      "a turn with no time",
      {
        id: "s",
        status: "active",
        messages: [{ id: "m", role: "question", text: "x" }],
        createdAt: "a",
        updatedAt: "b",
      },
    ],
  ])("refuses a stored session with %s", (_name, value) => {
    expect(isReflectSession(value)).toBe(false);
  });

  it("accepts a stored session whose answer cites the journal by reference", () => {
    expect(
      isReflectSession({
        id: "s",
        status: "finished",
        messages: [
          { id: "q", role: "question", text: "Why?", at: "t" },
          {
            id: "a",
            role: "answer",
            at: "t",
            answer: {
              markdown: "Because. [c1]",
              citations: [
                {
                  claimId: "c1",
                  evidence: [
                    {
                      entryId: "e",
                      responseKey: "good",
                      start: 0,
                      end: 4,
                      sourceHash: "h",
                    },
                  ],
                },
              ],
              sources: [{ entryId: "e", sourceHash: "h" }],
              coverage: {
                includedEntryIds: ["e"],
                omittedEntryCount: 2,
                truncated: true,
              },
            },
          },
        ],
        createdAt: "a",
        updatedAt: "b",
      }),
    ).toBe(true);
  });
});

describe("finishing and deleting on the session screen (RF-007, RF-008)", () => {
  async function saved(): Promise<{
    services: TestServices;
    provider: FakeProvider;
    id: string;
  }> {
    const made = await setUp();
    const session = await made.services.reflect.start({
      question: "What has gone well?",
      answer: SAVED_ANSWER,
    });
    return { ...made, id: session.id };
  }

  it("leaving a reflection and coming back does not finish it", async () => {
    const { services, id } = await saved();
    await renderApp(pathFor("reflect-session", { id }), services);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Ask more" });

    await user.click(screen.getByRole("link", { name: "Back to Reflect" }));
    await user.click(await screen.findByRole("link", { name: /Session from/ }));

    await screen.findByRole("heading", { name: "Ask more" });
    expect((await services.reflect.get(id))?.status).toBe("active");
  });

  it("says Open or Finished in the list", async () => {
    const { services, id } = await saved();
    await renderApp("/reflect", services);
    expect(
      (await screen.findByRole("link", { name: /Session from/ })).textContent,
    ).toMatch(/Open$/);

    await services.reflect.finish(id);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Session from/ }).textContent,
      ).toMatch(/Finished$/);
    });
  });

  it("asks before finishing, says what it means, and cancelling changes nothing", async () => {
    const { services, id } = await saved();
    await renderApp(pathFor("reflect-session", { id }), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Finish Reflection" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(FINISH_EXPLAINED);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect((await services.reflect.get(id))?.status).toBe("active");
    expect(screen.getByRole("heading", { name: "Ask more" })).toBeTruthy();
  });

  it("finishing makes it read-only, says why, and calls no AI", async () => {
    const { services, provider, id } = await saved();
    await renderApp(pathFor("reflect-session", { id }), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Finish Reflection" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Finish Reflection",
      }),
    );

    await screen.findByText(FINISHED);
    expect(screen.queryByLabelText(BOX)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Finish Reflection" }),
    ).toBeNull();
    // Still readable, and still deletable.
    expect(screen.getByText("Synthetic saved answer.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Delete this reflection" }),
    ).toBeTruthy();
    expect(provider.calls).toEqual([]);
    const stored = await services.reflect.get(id);
    expect(stored?.status).toBe("finished");
    expect(stored?.messages).toHaveLength(2);
  });

  it("deletes for good only after a confirmation, and leaves the journal alone", async () => {
    const { services, provider, id } = await saved();
    await renderApp(pathFor("reflect-session", { id }), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete this reflection" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Your journal entries are not.");
    expect(dialog.textContent).toContain("There is no trash and no undo.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await services.reflect.get(id)).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: "Delete this reflection" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete reflection",
      }),
    );

    await screen.findByText(
      "The reflection has been removed from this device.",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(heading());
    });
    expect(screen.queryByText(/isn't on this device/)).toBeNull();
    expect(await services.reflect.list()).toEqual([]);
    expect(await services.records.list("journal-entry")).toHaveLength(3);
    expect(provider.calls).toEqual([]);
  });

  it("says so if finishing cannot be saved", async () => {
    const { services, id } = await saved();
    await renderApp(pathFor("reflect-session", { id }), services);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Finish Reflection" });
    services.records.put = () => Promise.reject(new Error("synthetic CANARY"));

    await user.click(screen.getByRole("button", { name: "Finish Reflection" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Finish Reflection",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Warmly couldn't save that.",
    );
    expect(document.body.textContent).not.toContain("CANARY");
    expect((await services.reflect.get(id))?.status).toBe("active");
  });
});

describe("an answer that has arrived is never lost (AI-014)", () => {
  it("is kept on screen with a way to save it when storing fails, and no second request is made", async () => {
    const { services, provider } = await setUp();
    await renderApp(NEW, services);
    const put = services.records.put.bind(services.records);
    let failing = true;
    services.records.put = (kind, record) =>
      failing && kind === "reflect-session"
        ? Promise.reject(new Error("synthetic CANARY"))
        : put(kind, record);

    await askAndSend("What has gone well?");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(ANSWER_NOT_SAVED);
    expect(document.body.textContent).not.toContain("CANARY");
    // The answer itself is on screen, and the question is still in the box.
    expect(screen.getByText(/A test answer about 2 entries\./)).toBeTruthy();
    expect(screen.getByLabelText(BOX)).toHaveProperty(
      "value",
      "What has gone well?",
    );
    expect(await services.reflect.list()).toEqual([]);

    failing = false;
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: "Save the answer" }));

    await screen.findByRole("heading", { name: "You asked" });
    expect(await services.reflect.list()).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("is saved as a new reflection if its own was finished on another device meanwhile", async () => {
    const { services } = await setUp();
    const session = await services.reflect.start({
      question: "What has gone well?",
      answer: SAVED_ANSWER,
    });
    await renderApp(pathFor("reflect-session", { id: session.id }), services);
    await screen.findByRole("heading", { name: "Ask more" });
    // As sync would, between the screen opening and the answer arriving:
    // the other device finishes this reflection.
    const add = services.reflect.add.bind(services.reflect);
    services.reflect.add = async (...args) => {
      await services.reflect.finish(session.id);
      return add(...args);
    };

    await askAndSend("And what was hard?");

    await waitFor(async () => {
      expect(await services.reflect.list()).toHaveLength(2);
    });
    const newest = (await services.reflect.list()).find(
      (each) => each.id !== session.id,
    );
    expect(newest === undefined ? "" : firstQuestion(newest)).toBe(
      "And what was hard?",
    );
    // The finished one is untouched, and the answer has its own address.
    expect((await services.reflect.get(session.id))?.messages).toHaveLength(2);
    await waitFor(() => {
      expect(window.location.pathname).toBe(
        pathFor("reflect-session", { id: newest?.id ?? "" }),
      );
    });
  });
});
