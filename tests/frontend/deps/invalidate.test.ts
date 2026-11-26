/**
 * Removing what was built from a journal entry that has since changed
 * (PRD DEP-002, DEP-003, DEP-005, SYNC-006, SYNC-007; AC-12, AC-17, AC-03;
 * invariant 6; ADR-0010).
 */
import { describe, expect, it, vi } from "vitest";

import type { ReflectionAnswer } from "../../../src/ai/contracts";
import { DEPENDENCY_RULES } from "../../../src/domain/dependency-rules";
import { buildIndex, ruleFor } from "../../../src/domain/deps/index";
import {
  Invalidator,
  findStale,
  invalidate,
} from "../../../src/domain/deps/invalidate";
import { createEventBus } from "../../../src/domain/events";
import { deleteEntry } from "../../../src/domain/journal/delete";
import { editEntry } from "../../../src/domain/journal/edit";
import { newEntry, type JournalEntry } from "../../../src/domain/journal/types";
import { REFLECT_SESSION_RULE } from "../../../src/domain/reflect/dependencies";
import { RecordReflectSessions } from "../../../src/domain/reflect/sessions";
import {
  MemoryRecordStore,
  type RecordStore,
} from "../../../src/storage/record-store";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { device, type Device } from "../sync/devices";

const SOURCES = import.meta.glob<string>("../../../src/domain/deps/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});

function entryOf(good: string): Promise<JournalEntry> {
  return newEntry({ good, improve: "Synthetic two", loved: "Synthetic three" });
}

/** An answer built from these entries, citing only the first. */
function answerFrom(entries: readonly JournalEntry[]): ReflectionAnswer {
  const [first] = entries;
  return {
    markdown: "CANARY synthetic answer. [c1]",
    citations:
      first === undefined
        ? []
        : [
            {
              claimId: "c1",
              evidence: [
                {
                  entryId: first.id,
                  responseKey: "good",
                  start: 0,
                  end: 4,
                  sourceHash: first.contentHash,
                },
              ],
            },
          ],
    sources: entries.map((each) => ({
      entryId: each.id,
      sourceHash: each.contentHash,
    })),
    coverage: {
      includedEntryIds: entries.map((each) => each.id),
      omittedEntryCount: 0,
      truncated: false,
    },
  };
}

async function sessionFrom(
  records: RecordStore,
  entries: readonly JournalEntry[],
): Promise<string> {
  const session = await new RecordReflectSessions(records).start({
    question: "CANARY question?",
    answer: answerFrom(entries),
  });
  return session.id;
}

async function setUp(): Promise<{
  records: MemoryRecordStore;
  deps: {
    records: MemoryRecordStore;
    events: ReturnType<typeof createEventBus>;
  };
  cited: JournalEntry;
  sent: JournalEntry;
  other: JournalEntry;
  session: string;
}> {
  const records = new MemoryRecordStore();
  const [cited, sent, other] = await Promise.all([
    entryOf("We cooked dinner together."),
    entryOf("A quiet walk."),
    entryOf("Nothing to do with it."),
  ]);
  for (const each of [cited, sent, other]) {
    await records.put("journal-entry", each);
  }
  const session = await sessionFrom(records, [cited, sent]);
  return {
    records,
    deps: { records, events: createEventBus() },
    cited,
    sent,
    other,
    session,
  };
}

const edited = (entry: JournalEntry, good: string) => ({
  responses: { ...entry.responses, good },
  feelings: entry.feelings ?? [],
});

describe("what makes a reflection stale (DEP-002, DEP-003, AC-12)", () => {
  it("deletes the whole dependent session when a cited entry is edited", async () => {
    const { records, deps, cited, session } = await setUp();

    await editEntry(deps, cited.id, edited(cited, "Changed."));
    const gone = await invalidate(records, DEPENDENCY_RULES);

    expect(gone).toEqual([{ kind: "reflect-session", id: session }]);
    expect(await records.get("reflect-session", session)).toBeUndefined();
    expect(await records.deleted("reflect-session")).toEqual([session]);
  });

  it("deletes it when an entry that was sent but not cited is edited", async () => {
    const { records, deps, sent, session } = await setUp();

    await editEntry(deps, sent.id, edited(sent, "Changed."));

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
  });

  it("deletes it when an entry it was built from is deleted", async () => {
    const { records, deps, cited, session } = await setUp();

    await deleteEntry(deps, cited.id);

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
    expect(await records.list("reflect-session")).toEqual([]);
  });

  it("keeps it when only the feelings of an entry change: the words are the same (D-24)", async () => {
    const { records, deps, cited, session } = await setUp();

    const after = await editEntry(deps, cited.id, {
      responses: cited.responses,
      feelings: ["calm"],
    });

    expect(after.contentHash).toBe(cited.contentHash);
    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);
    expect(await records.get("reflect-session", session)).toBeDefined();
  });

  it("keeps it when an entry it was not built from is edited or deleted", async () => {
    const { records, deps, other, session } = await setUp();

    await editEntry(deps, other.id, edited(other, "Changed."));
    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);
    await deleteEntry(deps, other.id);
    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);

    expect(await records.get("reflect-session", session)).toBeDefined();
  });

  it("keeps it when an entry is simply not on this device yet", async () => {
    const records = new MemoryRecordStore();
    const elsewhere = await entryOf("Not fetched yet.");

    const session = await sessionFrom(records, [elsewhere]);

    // Not here, and not known to be deleted: that says nothing.
    expect(await findStale(records, DEPENDENCY_RULES)).toEqual([]);
    await records.put("journal-entry", elsewhere);
    expect(await findStale(records, DEPENDENCY_RULES)).toEqual([]);
    expect(await records.get("reflect-session", session)).toBeDefined();
  });

  it("waits while an entry is changed in two places, and decides once the person has chosen", async () => {
    const { records, cited, session } = await setUp();
    const theirs = { ...cited, contentHash: "9".repeat(64) };
    const mine = { ...cited, contentHash: "8".repeat(64) };
    await records.put("journal-entry", mine);
    records.park(cited.id, theirs, 2);

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);

    await records.resolve("journal-entry", cited.id, "theirs", 2);
    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
  });

  it("deletes it when the person settles a conflict by accepting a deletion", async () => {
    const { records, cited, session } = await setUp();
    records.park(cited.id, undefined, 2);

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);
    await records.resolve("journal-entry", cited.id, "theirs", 2);

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
  });

  it("changes nothing when run again: the result is the same every time (SYNC-007)", async () => {
    const { records, deps, cited } = await setUp();
    await editEntry(deps, cited.id, edited(cited, "Changed."));

    expect(await invalidate(records, DEPENDENCY_RULES)).toHaveLength(1);
    const writes = vi.spyOn(records, "delete");

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);
    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);
    expect(writes).not.toHaveBeenCalled();
  });

  it("removes only the sessions that depend on the changed entry", async () => {
    const { records, deps, cited, other, session } = await setUp();
    const unrelated = await sessionFrom(records, [other]);

    await editEntry(deps, cited.id, edited(cited, "Changed."));
    await invalidate(records, DEPENDENCY_RULES);

    expect(
      (await records.list("reflect-session")).map((each) => each.id),
    ).toEqual([unrelated]);
    expect(session).not.toBe(unrelated);
  });

  it("leaves the journal alone: only derived records are ever deleted", async () => {
    const { records, deps, cited } = await setUp();
    await editEntry(deps, cited.id, edited(cited, "Changed."));

    await invalidate(records, DEPENDENCY_RULES);

    expect(await records.list("journal-entry")).toHaveLength(3);
  });

  it("a session with a citation its sent list does not name still depends on that entry", async () => {
    const records = new MemoryRecordStore();
    const entry = await entryOf("Cited only.");
    await records.put("journal-entry", entry);
    const answer = { ...answerFrom([entry]), sources: [] };
    const session = await new RecordReflectSessions(records).start({
      question: "Q?",
      answer,
    });

    await records.put("journal-entry", {
      ...entry,
      contentHash: "7".repeat(64),
    });

    expect(await findStale(records, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session.id },
    ]);
  });
});

describe("the index of what was built from what (D-13)", () => {
  it("is worked out from the records and lists each entry's dependents once", async () => {
    const { records, cited, sent, other, session } = await setUp();

    const index = await buildIndex(records, DEPENDENCY_RULES);

    expect(index.dependents.map((each) => each.id)).toEqual([session]);
    expect(index.of(cited.id).map((each) => each.id)).toEqual([session]);
    expect(index.of(sent.id).map((each) => each.id)).toEqual([session]);
    expect(index.of(other.id)).toEqual([]);
  });

  it("takes any kind of record whose rule says what it was built from", async () => {
    const records = new MemoryRecordStore();
    const entry = await entryOf("Synthetic.");
    await records.put("journal-entry", entry);
    // A made-up rule: every collection depends on that entry.
    const rule = ruleFor("card-collection", () => [
      { entryId: entry.id, sourceHash: entry.contentHash },
    ]);
    await records.put("card-collection", {
      id: "c1",
      name: "Synthetic",
      cardIds: [],
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
    });

    expect(await findStale(records, [rule])).toEqual([]);
    await records.delete("journal-entry", entry.id);

    expect(await invalidate(records, [rule])).toEqual([
      { kind: "card-collection", id: "c1" },
    ]);
    expect(rule.kind).toBe("card-collection");
    expect(REFLECT_SESSION_RULE.kind).toBe("reflect-session");
  });
});

describe("keeping watch while unlocked", () => {
  it("checks when started, and again after every change", async () => {
    const { records, deps, cited, sent, session } = await setUp();
    await editEntry(deps, cited.id, edited(cited, "Changed while away."));
    const watch = new Invalidator(records, DEPENDENCY_RULES);
    const told = vi.fn();
    watch.subscribe(told);

    watch.start();
    await watch.run();

    expect(await records.get("reflect-session", session)).toBeUndefined();
    expect(watch.removed).toBe(1);
    expect(told).toHaveBeenCalled();

    const second = await sessionFrom(records, [sent]);
    await watch.run();
    expect(watch.removed).toBe(1);
    await editEntry(deps, sent.id, edited(sent, "Changed later."));
    await watch.run();

    expect(await records.get("reflect-session", second)).toBeUndefined();
    expect(watch.removed).toBe(2);
    watch.stop();
  });

  it("forgets the count when the person has seen it, and when the app locks", async () => {
    const { records, deps, cited } = await setUp();
    const watch = new Invalidator(records, DEPENDENCY_RULES);
    const told = vi.fn();
    watch.start();
    await editEntry(deps, cited.id, edited(cited, "Changed."));
    await watch.run();
    expect(watch.removed).toBe(1);
    const stop = watch.subscribe(told);

    watch.acknowledge();
    expect(watch.removed).toBe(0);
    expect(told).toHaveBeenCalledTimes(1);
    watch.acknowledge();
    expect(told).toHaveBeenCalledTimes(1);

    stop();
    watch.stop();
    expect(told).toHaveBeenCalledTimes(1);
    expect(watch.removed).toBe(0);
  });

  it("does nothing after it is stopped, and starting twice watches once", async () => {
    const { records, deps, cited, session } = await setUp();
    const watch = new Invalidator(records, DEPENDENCY_RULES);
    const listening = vi.spyOn(records, "subscribe");
    watch.start();
    watch.start();
    expect(listening).toHaveBeenCalledTimes(1);
    await watch.run();
    watch.stop();
    watch.stop();

    await editEntry(deps, cited.id, edited(cited, "Changed after lock."));
    await Promise.resolve();

    expect(await records.get("reflect-session", session)).toBeDefined();
  });

  it("runs one check at a time, and one more for changes that arrived meanwhile", async () => {
    const { records, deps, cited, session } = await setUp();
    await editEntry(deps, cited.id, edited(cited, "Changed."));
    const watch = new Invalidator(records, DEPENDENCY_RULES);
    const listing = vi.spyOn(records, "deleted");

    // Three requests before the first has finished.
    const first = watch.run();
    const second = watch.run();
    const third = watch.run();
    await Promise.all([first, second, third]);

    expect(second).toBe(first);
    expect(third).toBe(first);
    // Two passes, not three: the one that was running, and one more for
    // everything that was asked for while it ran.
    expect(listing).toHaveBeenCalledTimes(2);
    expect(await records.get("reflect-session", session)).toBeUndefined();
    expect(watch.removed).toBe(0);
  });

  it("removes nothing, and does not fail, when the records cannot be read", async () => {
    const { records, deps, cited, session } = await setUp();
    await editEntry(deps, cited.id, edited(cited, "Changed."));
    const watch = new Invalidator(records, DEPENDENCY_RULES);
    vi.spyOn(records, "deleted").mockRejectedValueOnce(
      new Error("synthetic failure"),
    );

    await expect(watch.run()).resolves.toBeUndefined();
    expect(await records.get("reflect-session", session)).toBeDefined();
    expect(watch.removed).toBe(0);

    // The next check, after the next change, does the work.
    await watch.run();
    expect(await records.get("reflect-session", session)).toBeUndefined();
  });
});

describe("across a person's devices (SYNC-006, SYNC-007, AC-17)", () => {
  async function two(): Promise<{
    a: Device;
    b: Device;
    entry: JournalEntry;
    session: string;
  }> {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const entry = await entryOf("We cooked dinner together.");
    await a.store.put("journal-entry", entry);
    const session = await sessionFrom(a.store, [entry]);
    await a.sync();
    await b.sync();
    return { a, b, entry, session };
  }

  const change = (one: Device, entry: JournalEntry, good: string) =>
    editEntry(
      { records: one.store, events: createEventBus() },
      entry.id,
      edited(entry, good),
    );

  it("an edit on one device removes the session on both, as a deletion that syncs", async () => {
    const { a, b, entry, session } = await two();
    expect(await b.store.get("reflect-session", session)).toBeDefined();
    b.online = false;

    await change(a, entry, "Changed on A.");
    await invalidate(a.store, DEPENDENCY_RULES);
    await a.sync();
    b.online = true;
    await b.sync();
    // B applies the same rule to what it now holds. It has nothing to do.
    expect(await invalidate(b.store, DEPENDENCY_RULES)).toEqual([]);

    for (const one of [a, b]) {
      expect(await one.store.get("reflect-session", session)).toBeUndefined();
      expect(await one.store.deleted("reflect-session")).toEqual([session]);
    }
  });

  it("comes to the same result if the other device learns of the edit before the deletion", async () => {
    const { a, b, entry, session } = await two();

    await change(a, entry, "Changed on A.");
    // A sends the edit but has not yet removed its own session.
    await a.sync();
    await b.sync();
    expect(await invalidate(b.store, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
    expect(await invalidate(a.store, DEPENDENCY_RULES)).toEqual([
      { kind: "reflect-session", id: session },
    ]);
    // Both deleted it. The two deletions meet without bringing it back.
    await b.sync();
    await a.sync();
    await b.sync();

    for (const one of [a, b]) {
      expect(await one.store.get("reflect-session", session)).toBeUndefined();
    }
  });

  it("a session made from the old text on a stale device is removed when it arrives", async () => {
    const { a, b, entry } = await two();
    b.online = false;
    await change(a, entry, "Changed on A.");
    await invalidate(a.store, DEPENDENCY_RULES);
    await a.sync();

    // B, still offline, has the old entry and builds a new session on it.
    const late = await sessionFrom(b.store, [entry]);
    b.online = true;
    await b.sync();
    await invalidate(b.store, DEPENDENCY_RULES);
    await b.sync();
    await a.sync();
    await invalidate(a.store, DEPENDENCY_RULES);

    for (const one of [a, b]) {
      expect(await one.store.get("reflect-session", late)).toBeUndefined();
    }
  });

  it("a deleted entry's session cannot come back from a device that was away", async () => {
    const { a, b, entry, session } = await two();
    b.online = false;

    await deleteEntry({ records: a.store, events: createEventBus() }, entry.id);
    await invalidate(a.store, DEPENDENCY_RULES);
    await a.sync();
    b.online = true;
    await b.sync();
    await invalidate(b.store, DEPENDENCY_RULES);
    await b.sync();
    await a.sync();

    for (const one of [a, b]) {
      expect(await one.store.get("journal-entry", entry.id)).toBeUndefined();
      expect(await one.store.get("reflect-session", session)).toBeUndefined();
    }
  });
});

describe("the engine's boundaries (invariant 6, AC-03)", () => {
  it("imports nothing from the AI layer, the network or the API", () => {
    const files = Object.entries(SOURCES);

    expect(files.map(([path]) => path.split("/").at(-1)).sort()).toEqual([
      "index.ts",
      "invalidate.ts",
    ]);
    for (const [path, source] of files) {
      const imports = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      for (const name of imports) {
        expect(name, path).not.toMatch(/(^|\/)ai(\/|$)|api\/client|sync\//);
      }
      expect(source, path).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
    }
  });
});
