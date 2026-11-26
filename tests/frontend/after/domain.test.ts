/**
 * What is written after a conversation: its own kind of record, optional
 * in every part, labelled as itself when it is sent, and a source that
 * what was built from it depends on (PRD PC-001 to PC-004, DEP-002,
 * SYNC-001, SYNC-005; AC-12; D-22).
 */
import { describe, expect, it } from "vitest";

import {
  UngroundedCitationError,
  groundReflection,
} from "../../../src/ai/grounding";
import { POLICY_RESERVE_TOKENS } from "../../../src/ai/config";
import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { buildManifest } from "../../../src/ai/manifest";
import { reflectTexts } from "../../../src/ai/prompts/reflect";
import { promptFor } from "../../../src/ai/manifest";
import { DEPENDENCY_RULES } from "../../../src/domain/dependency-rules";
import { findStale, invalidate } from "../../../src/domain/deps/invalidate";
import { newEntry } from "../../../src/domain/journal/types";
import {
  AfterNotFoundError,
  NothingToSaveError,
  createAfter,
  deleteAfter,
  editAfter,
} from "../../../src/domain/post-conversation/service";
import {
  AFTER_PROMPTS,
  canSaveAfter,
  canonicalAfter,
  isAfterNote,
  isPostConversationReflection,
  newAfter,
  type PostConversationReflection,
} from "../../../src/domain/post-conversation/types";
import { askRequest } from "../../../src/domain/reflect/ask";
import { selectContext } from "../../../src/domain/reflect/context";
import { RecordReflectSessions } from "../../../src/domain/reflect/sessions";
import { OUTBOX, RECORDS, type StoredRecord } from "../../../src/storage/db";
import { MemoryRecordStore } from "../../../src/storage/record-store";
import {
  chooseVersion,
  keepAsNew,
  listCardConflicts,
} from "../../../src/sync/card-conflicts";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { readRows } from "../storage/idb-snapshot";
import { OWNER, device } from "../sync/devices";

const WORDS = {
  went_well: "CANARY we both stayed calm.",
  difficult: "",
  remember: "CANARY to ask before assuming.",
};
const BLANK = { went_well: "  ", difficult: "", remember: "\n\t" };
const AT = new Date("2026-11-20T18:30:00.000Z");

describe("what is written after a conversation is its own record (PC-001, PC-003)", () => {
  it("asks the PRD's three questions, in order", () => {
    expect(AFTER_PROMPTS).toEqual([
      { key: "went_well", label: "What went well?" },
      { key: "difficult", label: "What felt difficult or unresolved?" },
      { key: "remember", label: "What would you like to remember?" },
    ]);
  });

  it("is saved with one answer and the others empty", async () => {
    const records = new MemoryRecordStore();

    const made = await createAfter(
      records,
      { went_well: "", difficult: "", remember: "One thing." },
      AT,
    );

    expect(await records.list("post-conversation")).toEqual([made]);
    expect(made.createdAt).toBe("2026-11-20T18:30:00.000Z");
    expect(made.entryDate.date).toBe("2026-11-20");
  });

  it("is never stored as a journal entry, and has no status or feelings", async () => {
    const records = new MemoryRecordStore();

    const made = await createAfter(records, WORDS, AT);

    expect(await records.list("journal-entry")).toEqual([]);
    expect(Object.keys(made).sort()).toEqual([
      "contentHash",
      "createdAt",
      "entryDate",
      "id",
      "responses",
      "updatedAt",
    ]);
  });

  it("is not saved when nothing is written, even with spaces in the boxes", async () => {
    const records = new MemoryRecordStore();

    expect(canSaveAfter(BLANK)).toBe(false);
    await expect(createAfter(records, BLANK)).rejects.toBeInstanceOf(
      NothingToSaveError,
    );
    expect(await records.list("post-conversation")).toEqual([]);
  });

  it("takes its hash over a form no journal entry can have", () => {
    expect(canonicalAfter(WORDS)).toBe(
      '{"v":1,"kind":"post_conversation","went_well":"CANARY we both stayed calm.","difficult":"","remember":"CANARY to ask before assuming."}',
    );
  });

  it("is told apart from a journal entry when read back", async () => {
    const after = await newAfter(WORDS, AT);
    const entry = await newEntry({ good: "a", improve: "b", loved: "c" });

    expect(isPostConversationReflection(after)).toBe(true);
    expect(isPostConversationReflection(entry)).toBe(false);
    expect(
      isPostConversationReflection({
        ...after,
        responses: { ...after.responses, good: "a" },
      }),
    ).toBe(false);
    expect(isPostConversationReflection({ ...after, status: "complete" })).toBe(
      false,
    );
    expect(
      isPostConversationReflection({ ...after, entryDate: { date: "x" } }),
    ).toBe(false);
    expect(isPostConversationReflection(null)).toBe(false);
  });
});

describe("it can be changed and deleted (PC-003)", () => {
  it("keeps its ID and its day when changed, and gets a new hash", async () => {
    const records = new MemoryRecordStore();
    const made = await createAfter(records, WORDS, AT);

    const changed = await editAfter(
      records,
      made.id,
      { ...WORDS, difficult: "One thing was left open." },
      new Date("2026-11-22T09:00:00.000Z"),
    );

    expect(changed.id).toBe(made.id);
    expect(changed.createdAt).toBe(made.createdAt);
    expect(changed.entryDate).toEqual(made.entryDate);
    expect(changed.updatedAt).toBe("2026-11-22T09:00:00.000Z");
    expect(changed.contentHash).not.toBe(made.contentHash);
    expect(await records.get("post-conversation", made.id)).toEqual(changed);
  });

  it("cannot be emptied by an edit, or changed when it is not here", async () => {
    const records = new MemoryRecordStore();
    const made = await createAfter(records, WORDS, AT);

    await expect(editAfter(records, made.id, BLANK)).rejects.toBeInstanceOf(
      NothingToSaveError,
    );
    await expect(
      editAfter(records, "00000000-0000-4000-8000-00000000dead", WORDS),
    ).rejects.toBeInstanceOf(AfterNotFoundError);
    expect(await records.get("post-conversation", made.id)).toEqual(made);
  });

  it("is deleted for good, and deleting what is not here does nothing", async () => {
    const records = new MemoryRecordStore();
    const made = await createAfter(records, WORDS, AT);

    expect(await deleteAfter(records, made.id)).toBe(true);
    expect(await deleteAfter(records, made.id)).toBe(false);
    expect(await records.list("post-conversation")).toEqual([]);
    expect(await records.deleted("post-conversation")).toEqual([made.id]);
  });
});

describe("it is sent to Reflect labelled as what it is (PC-004)", () => {
  async function both(): Promise<{
    after: PostConversationReflection;
    request: ReturnType<typeof askRequest>;
  }> {
    const entry = await newEntry({
      good: "We cooked dinner together.",
      improve: "Listen more.",
      loved: "A note in my bag.",
    });
    const after = await newAfter(WORDS, AT);
    return {
      after,
      request: askRequest({
        question: "What helps us talk?",
        entries: [{ ...entry, status: "complete" }],
        after: [after],
        session: undefined,
        sizing: undefined,
      }),
    };
  }

  it("goes under its own kind and its own answer names, never the journal's", async () => {
    const { after, request } = await both();

    const sent = request.entries.find((each) => each.id === after.id);
    expect(sent).toEqual({
      id: after.id,
      contentHash: after.contentHash,
      kind: "post_conversation",
      responses: WORDS,
    });
    const entry = request.entries.find((each) => each.id !== after.id);
    expect(entry !== undefined && "kind" in entry).toBe(false);
    expect(Object.keys(entry?.responses ?? {})).toEqual([
      "good",
      "improve",
      "loved",
    ]);
  });

  it("is named by kind in what the provider is given", async () => {
    const { request } = await both();
    const manifest = buildManifest(request.entries);
    const prompt = promptFor(request, manifest);

    const material = JSON.parse(reflectTexts(prompt).material) as {
      entries: Record<string, string>[];
    };

    expect(material.entries.map((each) => each["kind"]).sort()).toEqual([
      "journal_entry",
      "post_conversation",
    ]);
    const sent = material.entries.find(
      (each) => each["kind"] === "post_conversation",
    );
    expect(Object.keys(sent ?? {})).toEqual([
      "name",
      "kind",
      "went_well",
      "difficult",
      "remember",
    ]);
  });

  it("can be cited by its own answer, and a journal answer name is refused for it", async () => {
    const { after, request } = await both();
    const manifest = buildManifest(request.entries);
    const alias = manifest.sources.find(
      (each) => each.entryId === after.id,
    )?.alias;
    const citing = (key: string): unknown => ({
      markdown: "A reading. [c1]",
      citations: [
        {
          claimId: "c1",
          evidence: [{ alias, key, quote: "stayed calm" }],
        },
      ],
    });

    const grounded = groundReflection(citing("went_well"), manifest);

    expect(grounded.citations[0]?.evidence[0]).toMatchObject({
      entryId: after.id,
      responseKey: "went_well",
      sourceHash: after.contentHash,
    });
    expect(() => groundReflection(citing("good"), manifest)).toThrow(
      UngroundedCitationError,
    );
  });

  it("says how many notes were left out when not everything fits", async () => {
    const notes = await Promise.all(
      [1, 2, 3].map((day) =>
        newAfter(
          { went_well: `Note ${String(day)}`, difficult: "", remember: "" },
          new Date(`2026-11-0${String(day)}T10:00:00.000Z`),
        ),
      ),
    );

    const request = askRequest({
      question: "What do I want to keep?",
      entries: [],
      after: notes,
      session: undefined,
      // Room for one piece of writing and not for two: each needs 11.
      sizing: {
        budget: {
          maxInputTokens: POLICY_RESERVE_TOKENS + 5 + 20,
          maxOutputTokens: 0,
          timeoutMs: 1000,
        },
        estimate: (sized) => 5 + sized.entries.length * 10,
      },
    });

    expect(request.entries).toHaveLength(1);
    expect(request.coverage).toEqual({
      truncated: true,
      omittedEntryCount: 2,
      afterOmitted: 2,
    });
  });

  it("says which of the things too long to send are notes, and still sends the rest", async () => {
    const entry = {
      ...(await newEntry({ good: "Short.", improve: "b", loved: "c" })),
      status: "complete" as const,
    };
    const long = await newAfter(
      { went_well: "LONG ".repeat(50), difficult: "", remember: "" },
      AT,
    );

    const request = askRequest({
      question: "What helped?",
      entries: [entry],
      after: [long],
      session: undefined,
      // An ordinary piece of writing is sized at 10; the long note at 500.
      // The room for writing is 85, so the entry fits and the note cannot.
      sizing: {
        budget: {
          maxInputTokens: POLICY_RESERVE_TOKENS + 5 + 100,
          maxOutputTokens: 0,
          timeoutMs: 1000,
        },
        estimate: (sized) =>
          5 +
          sized.entries.reduce(
            (sum, each) => sum + ("kind" in each ? 500 : 10),
            0,
          ),
      },
    });

    expect(request.entries.map((each) => each.id)).toEqual([entry.id]);
    expect(request.coverage).toEqual({
      truncated: true,
      omittedEntryCount: 1,
      tooLong: 1,
      afterOmitted: 1,
      afterTooLong: 1,
    });
    const disclosure = new AiGateway(new FakeProvider()).disclose(request);
    expect(disclosure).toMatchObject({
      entries: 1,
      after: 0,
      omitted: 1,
      afterOmitted: 1,
      tooLong: 1,
      afterTooLong: 1,
    });
  });

  it("is chosen among by the same rule as an entry: the kind changes nothing", async () => {
    // Twelve pieces of writing, one a day. Once as entries only, once with
    // every third one a note instead. The same days must be chosen.
    const days = Array.from({ length: 12 }, (_, index) => index + 1);
    const when = (day: number): Date =>
      new Date(`2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`);
    const text = (day: number): string => `Day ${String(day)} dinner`;
    const asEntry = async (day: number) => ({
      ...(await newEntry(
        { good: text(day), improve: "", loved: "" },
        when(day),
      )),
      status: "complete" as const,
    });
    const asNote = (day: number) =>
      newAfter(
        { went_well: text(day), difficult: "", remember: "" },
        when(day),
      );
    const input = {
      question: "dinner on day 3",
      budget: 5,
      estimate: () => 1,
    };

    const plain = selectContext({
      ...input,
      entries: await Promise.all(days.map(asEntry)),
    });
    const mixed = selectContext({
      ...input,
      entries: await Promise.all(
        days.map((day) => (day % 3 === 0 ? asNote(day) : asEntry(day))),
      ),
    });

    expect(mixed.entries.map((each) => each.entryDate.date)).toEqual(
      plain.entries.map((each) => each.entryDate.date),
    );
    expect(mixed.entries).toHaveLength(5);
    expect(mixed.coverage.omittedEntryCount).toBe(7);
    expect(plain.coverage.omittedEntryCount).toBe(7);
  });

  it("is told from a journal entry by one rule, which the stored form enforces", async () => {
    const entry = await newEntry({ good: "a", improve: "b", loved: "c" });
    const note = await newAfter(WORDS, AT);

    expect(isAfterNote(note)).toBe(true);
    expect(isAfterNote(entry)).toBe(false);
    expect(isAfterNote({ ...entry, status: "draft" })).toBe(false);
    // A note can never come to have a status: such a record is not a note.
    expect(isPostConversationReflection({ ...note, status: "complete" })).toBe(
      false,
    );
  });

  it("alone, with no journal entry, is enough to ask about", async () => {
    const after = await newAfter(WORDS, AT);

    const request = askRequest({
      question: "What do I want to keep?",
      entries: [],
      after: [after],
      session: undefined,
      sizing: undefined,
    });

    expect(request.entries.map((each) => each.id)).toEqual([after.id]);
  });
});

describe("what was built from it goes when it changes (DEP-002, AC-12)", () => {
  async function built(): Promise<{
    records: MemoryRecordStore;
    after: PostConversationReflection;
    session: string;
  }> {
    const records = new MemoryRecordStore();
    const after = await createAfter(records, WORDS, AT);
    const session = await new RecordReflectSessions(records).start({
      question: "CANARY question?",
      answer: {
        markdown: "CANARY answer.",
        citations: [],
        sources: [{ entryId: after.id, sourceHash: after.contentHash }],
        coverage: {
          includedEntryIds: [after.id],
          omittedEntryCount: 0,
          truncated: false,
        },
      },
    });
    return { records, after, session: session.id };
  }

  it("leaves the session alone while the words are the same", async () => {
    const { records } = await built();

    expect(await findStale(records, DEPENDENCY_RULES)).toEqual([]);
  });

  it("removes the session when its words are changed", async () => {
    const { records, after, session } = await built();

    await editAfter(records, after.id, { ...WORDS, difficult: "More." });

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
    expect(await records.get("reflect-session", session)).toBeUndefined();
  });

  it("removes the session when it is deleted", async () => {
    const { records, after, session } = await built();

    await deleteAfter(records, after.id);

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
  });

  it("waits while it is changed in two places and not yet settled", async () => {
    const { records, after } = await built();
    const theirs = { ...after, contentHash: "f".repeat(64) };
    await editAfter(records, after.id, { ...WORDS, difficult: "Mine." });
    records.park(after.id, theirs, 2, "post-conversation");

    expect(await findStale(records, DEPENDENCY_RULES)).toEqual([]);
  });
});

describe("it syncs like any private record (SYNC-001, SYNC-005)", () => {
  it("is ciphertext under its own type number, and appears on the other device", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const made = await createAfter(a.store, WORDS, AT);
    await a.sync();
    await b.sync();

    expect(await b.store.get("post-conversation", made.id)).toEqual(made);
    const rows = await readRows<StoredRecord>(a.name, RECORDS);
    expect(rows.map((row) => row.type)).toEqual([5]);
    expect(
      JSON.stringify([rows, await readRows(a.name, OUTBOX)]),
    ).not.toContain("CANARY");
    const held = server
      .pull(OWNER, "0")
      .changes.map((change) =>
        new TextDecoder().decode(change.payload ?? new Uint8Array()),
      )
      .join("");
    expect(held).not.toContain("CANARY");
  });

  it("is read back from its stored envelope after the app is closed and opened again", async () => {
    const server = new MemoryServer();
    const first = await device(server);
    const made = await createAfter(first.store, WORDS, AT);

    // The same local database, opened afresh, as after a restart.
    const again = await device(server, undefined, { name: first.name });

    expect(await again.store.get("post-conversation", made.id)).toEqual(made);
    // It is bound to its own type: it is not found as any other kind.
    expect(await again.store.get("journal-entry", made.id)).toBeUndefined();
    expect(await again.store.list("journal-entry")).toEqual([]);
    expect(await again.store.unreadable("journal-entry")).toBe(0);
  });

  it("keeps both versions when changed on two devices, until one is chosen", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const made = await createAfter(a.store, WORDS, AT);
    await a.sync();
    await b.sync();
    await editAfter(a.store, made.id, { ...WORDS, difficult: "From A." });
    await editAfter(b.store, made.id, { ...WORDS, difficult: "From B." });
    await a.sync();
    await b.sync();

    const [conflict] = await listCardConflicts(b.store);
    expect(conflict).toMatchObject({
      record: "post-conversation",
      id: made.id,
      kind: "edited",
    });
    expect(
      conflict?.record === "post-conversation" &&
        conflict.mine?.responses.difficult,
    ).toBe("From B.");
    expect(
      conflict?.record === "post-conversation" &&
        conflict.theirs?.responses.difficult,
    ).toBe("From A.");

    if (conflict === undefined) {
      throw new Error("expected a conflict");
    }
    await chooseVersion(b.store, conflict, "theirs");

    expect(
      (await b.store.get("post-conversation", made.id))?.responses.difficult,
    ).toBe("From A.");
    expect(await listCardConflicts(b.store)).toEqual([]);
  });

  it("does not come back after being deleted elsewhere: the words are kept as a new one", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const made = await createAfter(a.store, WORDS, AT);
    await a.sync();
    await b.sync();
    await deleteAfter(a.store, made.id);
    await editAfter(b.store, made.id, { ...WORDS, difficult: "Kept." });
    await a.sync();
    await b.sync();

    const [conflict] = await listCardConflicts(b.store);
    expect(conflict?.kind).toBe("deleted-elsewhere");
    if (conflict === undefined) {
      throw new Error("expected a conflict");
    }
    await keepAsNew(b.store, conflict, new Date("2026-11-23T08:00:00.000Z"));

    const [kept] = await b.store.list("post-conversation");
    expect(kept?.id).not.toBe(made.id);
    expect(kept?.responses.difficult).toBe("Kept.");
    expect(kept?.entryDate).toEqual(made.entryDate);
    expect(await b.store.get("post-conversation", made.id)).toBeUndefined();
  });
});
