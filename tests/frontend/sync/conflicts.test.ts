import { describe, expect, it } from "vitest";

import { createEventBus, type DomainEvents } from "../../../src/domain/events";
import { completedFrom, draftFrom } from "../../../src/domain/journal/drafts";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  OUTBOX,
  PARKED,
  RECORDS,
  type StoredRecord,
} from "../../../src/storage/db";
import {
  EncryptedRecordStore,
  RecordDeletedError,
  StoreLockedError,
} from "../../../src/storage/encrypted-record-store";
import { MemoryRecordStore } from "../../../src/storage/record-store";
import {
  ConflictGoneError,
  IncompleteMergeError,
  keepMerged,
  keepMine,
  keepTheirs,
  listConflicts,
  type ConflictDeps,
} from "../../../src/sync/conflicts";
import type { RemoteChange } from "../../../src/sync/protocol";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { readRows } from "../storage/idb-snapshot";
import { OWNER, apply, device, entry, type Device } from "./devices";

/** An event bus that remembers what was announced. */
function listening(store: EncryptedRecordStore | MemoryRecordStore): {
  deps: ConflictDeps;
  changed: DomainEvents["journal.changed"][];
  deleted: DomainEvents["journal.deleted"][];
} {
  const events = createEventBus();
  const changed: DomainEvents["journal.changed"][] = [];
  const deleted: DomainEvents["journal.deleted"][] = [];
  events.on("journal.changed", (event) => {
    changed.push(event);
  });
  events.on("journal.deleted", (event) => {
    deleted.push(event);
  });
  return { deps: { records: store, events }, changed, deleted };
}

function answers(good: string): {
  responses: JournalEntry["responses"];
  feelings: [];
} {
  return {
    responses: { good, improve: "Synthetic two", loved: "Synthetic three" },
    feelings: [],
  };
}

/**
 * Two devices that both changed one entry from the same starting point.
 * `b` synced second, so `b` is the one holding both versions.
 */
async function clash(): Promise<{
  server: MemoryServer;
  a: Device;
  b: Device;
  fromA: JournalEntry;
  fromB: JournalEntry;
}> {
  const server = new MemoryServer();
  const [a, b] = [await device(server), await device(server)];
  const shared = await entry("shared");
  await a.store.put("journal-entry", shared);
  await a.sync();
  await b.sync();
  const fromA = await completedFrom(answers("from A"), shared);
  const fromB = await completedFrom(answers("from B"), shared);
  await a.store.put("journal-entry", fromA);
  await b.store.put("journal-entry", fromB);
  await a.sync();
  await b.sync();
  return { server, a, b, fromA, fromB };
}

describe("an entry changed on two devices (SYNC-004, AC-16)", () => {
  it("keeps both versions until the person chooses", async () => {
    const { a, b, fromA, fromB } = await clash();

    const conflicts = await listConflicts(b.store);

    expect(conflicts).toEqual([
      { id: fromB.id, kind: "edited", mine: fromB, theirs: fromA },
    ]);
    expect(b.engine.state()).toEqual({ status: "attention", waiting: 1 });
    // The entry itself still reads as this device's version.
    expect(await b.store.get("journal-entry", fromB.id)).toEqual(fromB);
    // The device whose change the server accepted has nothing to choose.
    expect(await listConflicts(a.store)).toEqual([]);
    expect(a.engine.state()).toEqual({ status: "synced", waiting: 0 });
  });

  it("keeping this device's version sends it on top of the other and both converge", async () => {
    const { server, a, b, fromB } = await clash();
    const { deps, changed } = listening(b.store);

    await keepMine(deps, fromB.id);

    expect(await listConflicts(b.store)).toEqual([]);
    expect(await readRows(b.name, PARKED)).toEqual([]);
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    await a.sync();
    expect(await a.store.get("journal-entry", fromB.id)).toEqual(fromB);
    expect(server.pull(OWNER, "0").changes).toMatchObject([{ revision: 3 }]);
    // Nothing changed on this device, so nothing is announced here.
    expect(changed).toEqual([]);
  });

  it("keeping the other version replaces this device's, sends nothing, and says what changed", async () => {
    const { server, a, b, fromA, fromB } = await clash();
    const { deps, changed } = listening(b.store);

    await keepTheirs(deps, fromB.id);

    expect(await b.store.get("journal-entry", fromB.id)).toEqual(fromA);
    expect(await readRows(b.name, OUTBOX)).toEqual([]);
    expect(await readRows(b.name, PARKED)).toEqual([]);
    expect(await readRows<StoredRecord>(b.name, RECORDS)).toMatchObject([
      { baseRevision: 2, dirty: false, tombstone: false },
    ]);
    expect(changed).toEqual([
      {
        entryId: fromB.id,
        oldHash: fromB.contentHash,
        newHash: fromA.contentHash,
      },
    ]);
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    expect(server.pull(OWNER, "0").changes).toMatchObject([{ revision: 2 }]);
    await a.sync();
    expect(await a.store.get("journal-entry", fromB.id)).toEqual(fromA);
  });

  it("a version written from both replaces the two, and both devices converge on it", async () => {
    const { a, b, fromB } = await clash();
    const { deps, changed } = listening(b.store);
    const now = new Date("2026-11-25T12:00:00.000Z");

    const merged = await keepMerged(deps, fromB.id, answers("from both"), now);

    expect(merged).toMatchObject({
      id: fromB.id,
      createdAt: fromB.createdAt,
      entryDate: fromB.entryDate,
      updatedAt: now.toISOString(),
      status: "complete",
      responses: { good: "from both" },
    });
    expect(changed).toEqual([
      {
        entryId: fromB.id,
        oldHash: fromB.contentHash,
        newHash: merged.contentHash,
      },
    ]);
    expect(await listConflicts(b.store)).toEqual([]);
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    await a.sync();
    expect(await a.store.get("journal-entry", fromB.id)).toEqual(merged);
    expect(await b.store.get("journal-entry", fromB.id)).toEqual(merged);
  });

  it("refuses a merged entry with an empty answer, and changes nothing", async () => {
    const { b, fromA, fromB } = await clash();
    const { deps, changed } = listening(b.store);

    await expect(
      keepMerged(deps, fromB.id, {
        responses: { good: "  ", improve: "x", loved: "y" },
        feelings: [],
      }),
    ).rejects.toThrow(IncompleteMergeError);

    expect(await listConflicts(b.store)).toMatchObject([
      { mine: fromB, theirs: fromA },
    ]);
    expect(changed).toEqual([]);
  });

  it("settles a second clash that arrives before the first choice was sent", async () => {
    const { a, b, fromA, fromB } = await clash();
    const { deps } = listening(b.store);
    await keepMine(deps, fromB.id);
    // Before b syncs, a changes the entry again.
    const again = await completedFrom(answers("from A again"), fromA);
    await a.store.put("journal-entry", again);
    await a.sync();

    expect(await b.sync()).toEqual({ status: "attention", waiting: 1 });
    expect(await listConflicts(b.store)).toEqual([
      { id: fromB.id, kind: "edited", mine: fromB, theirs: again },
    ]);

    await keepMine(deps, fromB.id);
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    await a.sync();
    expect(await a.store.get("journal-entry", fromB.id)).toEqual(fromB);
  });

  it("stops saying it needs attention once the other version is kept", async () => {
    const { b, fromB } = await clash();
    const { deps } = listening(b.store);

    await keepTheirs(deps, fromB.id);

    // No cycle has run yet: the status follows the store.
    await expect
      .poll(() => b.engine.state())
      .toEqual({ status: "synced", waiting: 0 });
  });

  it("says it needs attention even while offline or failing, because the choice needs no connection", async () => {
    const { server, b } = await clash();

    b.online = false;
    expect(await b.sync()).toEqual({ status: "attention", waiting: 1 });
    expect(b.engine.outcome()).toBe("offline");

    b.online = true;
    server.reachable = false;
    expect(await b.sync()).toEqual({ status: "attention", waiting: 1 });
    expect(b.engine.outcome()).toBe("offline");

    // A restart while offline says so as well.
    b.store.lock();
    const restarted = await device(server, undefined, { name: b.name });
    restarted.online = false;
    expect(await restarted.sync()).toEqual({ status: "attention", waiting: 1 });
  });

  it("two drafts merge into a draft, with no answers required and nothing announced", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const draft = await draftFrom(answers("start"));
    await a.store.put("journal-entry", draft);
    await a.sync();
    await b.sync();
    await a.store.put("journal-entry", await draftFrom(answers("A"), draft));
    await b.store.put("journal-entry", await draftFrom(answers("B"), draft));
    await a.sync();
    await b.sync();
    const { deps, changed, deleted } = listening(b.store);

    const merged = await keepMerged(deps, draft.id, {
      responses: { good: "A and B", improve: "", loved: "" },
      feelings: [],
    });

    expect(merged.status).toBe("draft");
    expect([changed, deleted]).toEqual([[], []]);
  });

  it("a finished entry replaced by a draft is announced as gone", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const draft = await draftFrom(answers("start"));
    await a.store.put("journal-entry", draft);
    await a.sync();
    await b.sync();
    await a.store.put("journal-entry", await draftFrom(answers("A"), draft));
    const finished = await completedFrom(answers("B"), draft);
    await b.store.put("journal-entry", finished);
    await a.sync();
    await b.sync();
    const { deps, changed, deleted } = listening(b.store);

    await keepTheirs(deps, draft.id);

    expect(changed).toEqual([]);
    expect(deleted).toEqual([
      { entryId: draft.id, oldHash: finished.contentHash },
    ]);
  });

  it("says so when the entry is not waiting for a choice", async () => {
    const { b } = await clash();
    const { deps } = listening(b.store);
    const other = await entry("no clash");
    await b.store.put("journal-entry", other);

    for (const settle of [keepMine, keepTheirs]) {
      await expect(settle(deps, other.id)).rejects.toThrow(ConflictGoneError);
    }
    await expect(
      keepMerged(deps, crypto.randomUUID(), answers("x")),
    ).rejects.toThrow(ConflictGoneError);
    expect(await b.store.get("journal-entry", other.id)).toEqual(other);
  });

  it("lists the oldest entry first", async () => {
    const store = new MemoryRecordStore();
    const older = {
      ...(await entry("older")),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const newer = {
      ...(await entry("newer")),
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    await store.put("journal-entry", newer);
    await store.put("journal-entry", older);
    store.park(newer.id, newer);
    store.park(older.id, older);

    expect((await listConflicts(store)).map((each) => each.id)).toEqual([
      older.id,
      newer.id,
    ]);
  });
});

describe("a version that is deleted or cannot be read (SYNC-005)", () => {
  function remote(overrides: Partial<RemoteChange>): RemoteChange {
    return {
      recordId: crypto.randomUUID(),
      type: 1,
      revision: 5,
      sequence: 5,
      schemaVersion: 1,
      tombstone: false,
      payload: new Uint8Array(40).fill(1),
      ...overrides,
    };
  }

  it("is listed for what it is, and cannot be chosen in a way that brings a deleted entry back", async () => {
    const server = new MemoryServer();
    const b = await device(server);
    const [gone, unread] = [await entry("gone there"), await entry("unread")];
    await b.store.put("journal-entry", gone);
    await b.store.put("journal-entry", unread);
    await apply(
      b.store,
      remote({ recordId: gone.id, tombstone: true, payload: null }),
    );
    await apply(b.store, remote({ recordId: unread.id, schemaVersion: 99 }));
    const { deps } = listening(b.store);

    const conflicts = await listConflicts(b.store);

    expect(conflicts).toEqual(
      expect.arrayContaining([
        { id: gone.id, kind: "deleted-elsewhere", mine: gone },
        { id: unread.id, kind: "unreadable", mine: unread },
      ]),
    );
    expect(conflicts).toHaveLength(2);
    for (const id of [gone.id, unread.id]) {
      await expect(keepMine(deps, id)).rejects.toThrow(ConflictGoneError);
      await expect(keepTheirs(deps, id)).rejects.toThrow(ConflictGoneError);
    }
    await expect(
      b.store.resolve("journal-entry", gone.id, "mine"),
    ).rejects.toThrow(RecordDeletedError);
    expect(await b.store.get("journal-entry", gone.id)).toEqual(gone);
    expect(await b.store.parkedCount()).toBe(2);
  });

  it("an entry deleted here is listed as that, and the other version cannot bring it back", async () => {
    const { server, a, b, fromA } = await (async () => {
      const made = new MemoryServer();
      const [first, second] = [await device(made), await device(made)];
      const shared = await entry("shared");
      await first.store.put("journal-entry", shared);
      await first.sync();
      await second.sync();
      const edited = await completedFrom(answers("from A"), shared);
      await first.store.put("journal-entry", edited);
      await second.store.delete("journal-entry", shared.id);
      await first.sync();
      await second.sync();
      return { server: made, a: first, b: second, fromA: edited };
    })();

    expect(await listConflicts(b.store)).toEqual([
      { id: fromA.id, kind: "deleted-here", theirs: fromA },
    ]);
    await expect(
      b.store.resolve("journal-entry", fromA.id, "theirs"),
    ).rejects.toThrow(RecordDeletedError);
    expect(await b.store.list("journal-entry")).toEqual([]);
    // Nothing was sent that could delete or restore anything meanwhile.
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { revision: 2, tombstone: false },
    ]);
    expect(await a.store.get("journal-entry", fromA.id)).toEqual(fromA);
  });
});

describe("the stores' side of a choice (ADR-0006, ADR-0014)", () => {
  it("lists nothing and refuses a choice while locked", async () => {
    const { b, fromB } = await clash();
    b.store.lock();

    expect(await b.store.conflicts("journal-entry")).toEqual([]);
    await expect(
      b.store.resolve("journal-entry", fromB.id, "mine"),
    ).rejects.toThrow(StoreLockedError);
  });

  it("does nothing for a record that is not in conflict", async () => {
    const b = await device(new MemoryServer());
    const written = await entry();
    await b.store.put("journal-entry", written);
    const before = await readRows(b.name, RECORDS);

    await b.store.resolve("journal-entry", written.id, "theirs");
    await b.store.resolve("journal-entry", crypto.randomUUID(), "mine");

    expect(await readRows(b.name, RECORDS)).toEqual(before);
    expect(await readRows(b.name, OUTBOX)).toHaveLength(1);
  });

  it("keeps the choice across a restart: both versions are still there to choose from", async () => {
    const { server, b, fromA, fromB } = await clash();
    b.store.lock();

    const restarted = await device(server, undefined, { name: b.name });

    expect(await listConflicts(restarted.store)).toEqual([
      { id: fromB.id, kind: "edited", mine: fromB, theirs: fromA },
    ]);
  });

  it("stores the other version only as ciphertext", async () => {
    const { b } = await clash();

    const stored = JSON.stringify(
      await readRows(b.name, PARKED),
      (_key, value: unknown) =>
        ArrayBuffer.isView(value)
          ? new TextDecoder().decode(value as Uint8Array)
          : value,
    );

    expect(stored).not.toContain("from A");
    expect(stored).not.toContain("Synthetic");
  });

  it("the in-memory store settles a conflict the same way", async () => {
    const store = new MemoryRecordStore();
    const [mine, theirs] = [await entry("mine"), await entry("theirs")];
    const other = { ...theirs, id: mine.id };
    await store.put("journal-entry", mine);

    await store.resolve("journal-entry", mine.id, "theirs");
    expect(await store.get("journal-entry", mine.id)).toEqual(mine);

    store.park(mine.id, other);
    expect(await store.conflicts("journal-entry")).toEqual([
      { id: mine.id, mine, theirs: other, theirsDeleted: false },
    ]);
    await store.resolve("journal-entry", mine.id, "mine");
    expect(await store.get("journal-entry", mine.id)).toEqual(mine);
    expect(await store.conflicts("journal-entry")).toEqual([]);

    store.park(mine.id, other);
    await store.resolve("journal-entry", mine.id, "theirs");
    expect(await store.get("journal-entry", mine.id)).toEqual(other);

    store.park(mine.id, undefined);
    await expect(
      store.resolve("journal-entry", mine.id, "mine"),
    ).rejects.toThrow(RecordDeletedError);
    await store.resolve("journal-entry", mine.id, "theirs");
    expect(await store.get("journal-entry", mine.id)).toBeUndefined();

    store.park(mine.id, other);
    store.lock();
    expect(await store.conflicts("journal-entry")).toEqual([]);
  });
});
