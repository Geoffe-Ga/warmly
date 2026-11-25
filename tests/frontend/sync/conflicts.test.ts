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
  ConflictChangedError,
  ConflictGoneError,
  IncompleteMergeError,
  deleteAnyway,
  discardMine,
  keepEdited,
  keepMerged,
  keepMine,
  keepTheirs,
  listConflicts,
  isDeletedElsewhere,
  isDeletedHere,
  isEdited,
  saveAsNew,
  type ConflictDeps,
  type DeletedElsewhere,
  type DeletedHere,
  type EditedConflict,
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

/** The conflict as the review screen would show it for an entry. */
async function shown(deps: ConflictDeps, id: string): Promise<EditedConflict> {
  const conflict = (await listConflicts(deps.records)).find(
    (each) => each.id === id,
  );
  if (conflict === undefined || !isEdited(conflict)) {
    throw new Error("an entry with two readable versions is expected");
  }
  return conflict;
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
      { id: fromB.id, revision: 2, kind: "edited", mine: fromB, theirs: fromA },
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

    await keepMine(deps, await shown(deps, fromB.id));

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

    await keepTheirs(deps, await shown(deps, fromB.id));

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

    const merged = await keepMerged(
      deps,
      await shown(deps, fromB.id),
      answers("from both"),
      now,
    );

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
      keepMerged(deps, await shown(deps, fromB.id), {
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
    await keepMine(deps, await shown(deps, fromB.id));
    // Before b syncs, a changes the entry again.
    const again = await completedFrom(answers("from A again"), fromA);
    await a.store.put("journal-entry", again);
    await a.sync();

    expect(await b.sync()).toEqual({ status: "attention", waiting: 1 });
    expect(await listConflicts(b.store)).toEqual([
      { id: fromB.id, revision: 3, kind: "edited", mine: fromB, theirs: again },
    ]);

    await keepMine(deps, await shown(deps, fromB.id));
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    await a.sync();
    expect(await a.store.get("journal-entry", fromB.id)).toEqual(fromB);
  });

  it("does not remove a newer version that arrived while the person was reading the older one", async () => {
    const { a, b, fromA, fromB } = await clash();
    const { deps, changed } = listening(b.store);
    // The review is open, showing a's first change.
    const reading = await shown(deps, fromB.id);
    const told: string[] = [];
    b.store.subscribe(() => {
      told.push("changed");
    });
    // Meanwhile a changes the entry again and b's scheduler pulls it.
    const again = await completedFrom(answers("from A again"), fromA);
    await a.store.put("journal-entry", again);
    await a.sync();
    await b.sync();
    expect(told.length).toBeGreaterThan(0);
    const before = await readRows(b.name, RECORDS);
    const queued = await readRows(b.name, OUTBOX);

    for (const settle of [keepMine, keepTheirs]) {
      await expect(settle(deps, reading)).rejects.toThrow(ConflictChangedError);
    }
    await expect(
      keepMerged(deps, reading, answers("from both")),
    ).rejects.toThrow(ConflictChangedError);

    // Nothing moved: both versions, the newer one included, are still here.
    expect(await readRows(b.name, RECORDS)).toEqual(before);
    expect(await readRows(b.name, OUTBOX)).toEqual(queued);
    expect(changed).toEqual([]);
    expect(await listConflicts(b.store)).toEqual([
      { id: fromB.id, revision: 3, kind: "edited", mine: fromB, theirs: again },
    ]);
    // Shown the newer one, the person chooses again and it is stored.
    await keepTheirs(deps, await shown(deps, fromB.id));
    expect(await b.store.get("journal-entry", fromB.id)).toEqual(again);
  });

  it("stores a version written from both in one step: the text, the queued change and the removal together", async () => {
    const { b, fromB } = await clash();
    const { deps } = listening(b.store);
    const before = await readRows<StoredRecord>(b.name, RECORDS);
    const queued = await readRows(b.name, OUTBOX);

    const merged = await keepMerged(
      deps,
      await shown(deps, fromB.id),
      answers("from both"),
    );

    const [row] = await readRows<StoredRecord>(b.name, RECORDS);
    expect(row).toMatchObject({
      baseRevision: 2,
      dirty: true,
      localRevision: (before[0]?.localRevision ?? 0) + 1,
    });
    expect(await readRows(b.name, OUTBOX)).toHaveLength(queued.length + 1);
    expect(await readRows(b.name, PARKED)).toEqual([]);
    expect(await b.store.get("journal-entry", fromB.id)).toEqual(merged);
    // A restart reads the same thing back.
    b.store.lock();
    const again = await device(new MemoryServer(), undefined, { name: b.name });
    expect(await again.store.get("journal-entry", fromB.id)).toEqual(merged);
  });

  it("stores nothing of a merged version if the choice cannot be stored", async () => {
    const { b, fromB } = await clash();
    const { deps, changed } = listening(b.store);
    const reading = await shown(deps, fromB.id);
    const before = await readRows(b.name, RECORDS);

    // As if the other version had moved on: the one step is refused whole.
    await expect(
      keepMerged(deps, { ...reading, revision: 99 }, answers("from both")),
    ).rejects.toThrow(ConflictChangedError);

    expect(await readRows(b.name, RECORDS)).toEqual(before);
    expect(await b.store.get("journal-entry", fromB.id)).toEqual(fromB);
    expect(await readRows(b.name, PARKED)).toHaveLength(1);
    expect(changed).toEqual([]);
  });

  it("stops saying it needs attention once the other version is kept", async () => {
    const { b, fromB } = await clash();
    const { deps } = listening(b.store);

    await keepTheirs(deps, await shown(deps, fromB.id));

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

    const merged = await keepMerged(deps, await shown(deps, draft.id), {
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

    await keepTheirs(deps, await shown(deps, draft.id));

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

    // As a screen would hold it if the entry had been settled meanwhile.
    const stale: EditedConflict = {
      id: other.id,
      revision: 2,
      kind: "edited",
      mine: other,
      theirs: { ...other, updatedAt: "2026-01-01T00:00:00.000Z" },
    };
    const { changed, deleted } = listening(b.store);

    for (const settle of [keepMine, keepTheirs]) {
      await expect(settle(deps, stale)).rejects.toThrow(ConflictGoneError);
    }
    await expect(
      keepMerged(deps, { ...stale, id: crypto.randomUUID() }, answers("x")),
    ).rejects.toThrow(ConflictGoneError);
    expect(await b.store.get("journal-entry", other.id)).toEqual(other);
    // Nothing happened, so nothing is announced.
    expect([changed, deleted]).toEqual([[], []]);
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

    const conflicts = await listConflicts(b.store);

    expect(conflicts).toEqual(
      expect.arrayContaining([
        { id: gone.id, revision: 5, kind: "deleted-elsewhere", mine: gone },
        { id: unread.id, revision: 5, kind: "unreadable", mine: unread },
      ]),
    );
    expect(conflicts).toHaveLength(2);
    await expect(
      b.store.resolve("journal-entry", gone.id, "mine", 5),
    ).rejects.toThrow(RecordDeletedError);
    expect(await b.store.get("journal-entry", gone.id)).toEqual(gone);
    expect(await b.store.parkedCount()).toBe(2);
  });
});

/** The conflict as shown for an entry changed here and deleted elsewhere. */
async function there(
  deps: ConflictDeps,
  id: string,
): Promise<DeletedElsewhere> {
  const conflict = (await listConflicts(deps.records)).find(
    (each) => each.id === id,
  );
  if (conflict === undefined || !isDeletedElsewhere(conflict)) {
    throw new Error("an entry deleted elsewhere is expected");
  }
  return conflict;
}

/** The conflict as shown for an entry deleted here and changed elsewhere. */
async function here(deps: ConflictDeps, id: string): Promise<DeletedHere> {
  const conflict = (await listConflicts(deps.records)).find(
    (each) => each.id === id,
  );
  if (conflict === undefined || !isDeletedHere(conflict)) {
    throw new Error("an entry deleted here is expected");
  }
  return conflict;
}

/** `b` deleted an entry that `a` had meanwhile changed; `b` synced second. */
async function deletedHere(): Promise<{
  server: MemoryServer;
  a: Device;
  b: Device;
  fromA: JournalEntry;
}> {
  const server = new MemoryServer();
  const [a, b] = [await device(server), await device(server)];
  const shared = await entry("shared");
  await a.store.put("journal-entry", shared);
  await a.sync();
  await b.sync();
  const fromA = await completedFrom(answers("from A"), shared);
  await a.store.put("journal-entry", fromA);
  await b.store.delete("journal-entry", shared.id);
  await a.sync();
  await b.sync();
  return { server, a, b, fromA };
}

/** `a` deleted an entry that `b` had meanwhile changed; `b` synced second. */
async function deletedElsewhere(): Promise<{
  server: MemoryServer;
  a: Device;
  b: Device;
  fromB: JournalEntry;
}> {
  const server = new MemoryServer();
  const [a, b] = [await device(server), await device(server)];
  const shared = await entry("shared");
  await a.store.put("journal-entry", shared);
  await a.sync();
  await b.sync();
  const fromB = await completedFrom(answers("from B"), shared);
  await a.store.delete("journal-entry", shared.id);
  await b.store.put("journal-entry", fromB);
  await a.sync();
  await b.sync();
  return { server, a, b, fromB };
}

describe("an entry deleted on one device and changed on another (SYNC-005, AC-17)", () => {
  it("deleted here: the deletion waits, the other version is kept, and nothing is sent meanwhile", async () => {
    const { server, a, b, fromA } = await deletedHere();

    expect(await listConflicts(b.store)).toEqual([
      { id: fromA.id, revision: 2, kind: "deleted-here", theirs: fromA },
    ]);
    expect(b.engine.state()).toEqual({ status: "attention", waiting: 1 });
    expect(await b.store.list("journal-entry")).toEqual([]);
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { revision: 2, tombstone: false },
    ]);
    expect(await a.store.get("journal-entry", fromA.id)).toEqual(fromA);
  });

  it("deleted here, 'delete anyway': the entry is deleted everywhere and stays deleted", async () => {
    const { server, a, b, fromA } = await deletedHere();
    const { deps } = listening(b.store);

    await deleteAnyway(deps, await here(deps, fromA.id));

    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    await a.sync();
    expect(await a.store.list("journal-entry")).toEqual([]);
    expect(await b.store.list("journal-entry")).toEqual([]);
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { revision: 3, tombstone: true, payload: null },
    ]);
  });

  it("deleted here, 'keep the edited version': the deletion is taken back and nothing is sent", async () => {
    const { server, a, b, fromA } = await deletedHere();
    const { deps, deleted } = listening(b.store);

    await keepEdited(deps, await here(deps, fromA.id));

    expect(await b.store.get("journal-entry", fromA.id)).toEqual(fromA);
    expect(await readRows(b.name, OUTBOX)).toEqual([]);
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { revision: 2, tombstone: false },
    ]);
    expect(await a.store.get("journal-entry", fromA.id)).toEqual(fromA);
    expect(deleted).toEqual([]);
  });

  it("deleted elsewhere: the edit is refused, kept here, and never brings the entry back", async () => {
    const { server, a, b, fromB } = await deletedElsewhere();

    expect(await listConflicts(b.store)).toEqual([
      { id: fromB.id, revision: 2, kind: "deleted-elsewhere", mine: fromB },
    ]);
    expect(b.engine.state()).toEqual({ status: "attention", waiting: 1 });
    // The text is still here for the person to decide about.
    expect(await b.store.get("journal-entry", fromB.id)).toEqual(fromB);
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { revision: 2, tombstone: true, payload: null },
    ]);
    expect(await a.store.list("journal-entry")).toEqual([]);
  });

  it("deleted elsewhere, 'save as a new entry': the text lives on under a new ID and the old one stays deleted", async () => {
    const { server, a, b, fromB } = await deletedElsewhere();
    const { deps, deleted } = listening(b.store);

    const copy = await saveAsNew(deps, await there(deps, fromB.id));

    expect(copy).toEqual({ ...fromB, id: copy.id });
    expect(copy.id).not.toBe(fromB.id);
    expect(await b.store.list("journal-entry")).toEqual([copy]);
    expect(deleted).toEqual([
      { entryId: fromB.id, oldHash: fromB.contentHash },
    ]);
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    await a.sync();
    expect(await a.store.list("journal-entry")).toEqual([copy]);
    const stored = server.pull(OWNER, "0").changes;
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: fromB.id, tombstone: true }),
        expect.objectContaining({ recordId: copy.id, tombstone: false }),
      ]),
    );
  });

  it("deleted elsewhere, 'discard': this device's version is removed and nothing is sent", async () => {
    const { server, a, b, fromB } = await deletedElsewhere();
    const { deps, deleted } = listening(b.store);

    await discardMine(deps, await there(deps, fromB.id));

    expect(await b.store.list("journal-entry")).toEqual([]);
    expect(await readRows(b.name, OUTBOX)).toEqual([]);
    expect(deleted).toEqual([
      { entryId: fromB.id, oldHash: fromB.contentHash },
    ]);
    expect(await b.sync()).toEqual({ status: "synced", waiting: 0 });
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { revision: 2, tombstone: true },
    ]);
    expect(await a.store.list("journal-entry")).toEqual([]);
  });

  it("a draft deleted elsewhere is discarded without announcing anything", async () => {
    const store = new MemoryRecordStore();
    const draft = await draftFrom(answers("draft"));
    await store.put("journal-entry", draft);
    store.park(draft.id, undefined);
    const { deps, deleted } = listening(store);

    await discardMine(deps, await there(deps, draft.id));

    expect(deleted).toEqual([]);
    expect(await store.list("journal-entry")).toEqual([]);
  });

  it("a choice made twice, or after the entry was settled elsewhere, is refused and changes nothing", async () => {
    const { b, fromB } = await deletedElsewhere();
    const elsewhere = listening(b.store);
    const shownThere = await there(elsewhere.deps, fromB.id);
    await discardMine(elsewhere.deps, shownThere);
    const local = await deletedHere();
    const hereDeps = listening(local.b.store);
    const shownHere = await here(hereDeps.deps, local.fromA.id);
    await keepEdited(hereDeps.deps, shownHere);

    const asked: (() => Promise<unknown>)[] = [
      () => discardMine(elsewhere.deps, shownThere),
      () => saveAsNew(elsewhere.deps, shownThere),
      () => deleteAnyway(hereDeps.deps, shownHere),
      () => keepEdited(hereDeps.deps, shownHere),
    ];
    for (const ask of asked) {
      await expect(ask()).rejects.toThrow(ConflictGoneError);
    }

    // The copy that "save as new" made before it was refused is gone again.
    expect(await b.store.list("journal-entry")).toEqual([]);
    expect(elsewhere.deleted).toHaveLength(1);
    expect(await local.b.store.get("journal-entry", local.fromA.id)).toEqual(
      local.fromA,
    );
  });

  it("a choice about a deleted entry is refused if the other version changed again", async () => {
    const { a, b, fromA } = await deletedHere();
    const { deps } = listening(b.store);
    const reading = await here(deps, fromA.id);
    const again = await completedFrom(answers("from A again"), fromA);
    await a.store.put("journal-entry", again);
    await a.sync();
    await b.sync();

    for (const settle of [deleteAnyway, keepEdited]) {
      await expect(settle(deps, reading)).rejects.toThrow(ConflictChangedError);
    }

    expect(await listConflicts(b.store)).toEqual([
      { id: fromA.id, revision: 3, kind: "deleted-here", theirs: again },
    ]);
  });

  it("new text is never written over a deletion made here", async () => {
    const { b, fromA } = await deletedHere();
    const before = await readRows(b.name, RECORDS);
    const queued = await readRows(b.name, OUTBOX);

    await expect(
      b.store.resolve("journal-entry", fromA.id, "mine", 2, fromA),
    ).rejects.toThrow(RecordDeletedError);

    expect(await readRows(b.name, RECORDS)).toEqual(before);
    expect(await readRows(b.name, OUTBOX)).toEqual(queued);
    expect(await b.store.parkedCount()).toBe(1);
  });

  it("a deletion the server has accepted cannot be taken back", async () => {
    const server = new MemoryServer();
    const b = await device(server);
    const written = await entry();
    await b.store.put("journal-entry", written);
    await b.store.delete("journal-entry", written.id);
    await b.sync();
    // Left over from before the deletion was accepted.
    const database = await new Promise<IDBDatabase>((resolve) => {
      const opening = indexedDB.open(b.name);
      opening.onsuccess = () => {
        resolve(opening.result);
      };
    });
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(PARKED, "readwrite");
      transaction.objectStore(PARKED).put({
        type: 1,
        id: written.id,
        envelope: new Uint8Array(40).fill(1),
        schemaVersion: 1,
        revision: 9,
        tombstone: false,
      });
      transaction.oncomplete = () => {
        resolve();
      };
    });
    database.close();

    await expect(
      b.store.resolve("journal-entry", written.id, "theirs", 9),
    ).rejects.toThrow(RecordDeletedError);
    expect(await b.store.list("journal-entry")).toEqual([]);
  });
});

describe("the stores' side of a choice (ADR-0006, ADR-0014)", () => {
  it("lists nothing and refuses a choice while locked", async () => {
    const { b, fromB } = await clash();
    b.store.lock();

    expect(await b.store.conflicts("journal-entry")).toEqual([]);
    await expect(
      b.store.resolve("journal-entry", fromB.id, "mine", 2),
    ).rejects.toThrow(StoreLockedError);
  });

  it("does nothing for a record that is not in conflict", async () => {
    const b = await device(new MemoryServer());
    const written = await entry();
    await b.store.put("journal-entry", written);
    const before = await readRows(b.name, RECORDS);

    expect(
      await b.store.resolve("journal-entry", written.id, "theirs", 1),
    ).toBe(false);
    expect(
      await b.store.resolve("journal-entry", crypto.randomUUID(), "mine", 1),
    ).toBe(false);

    expect(await readRows(b.name, RECORDS)).toEqual(before);
    expect(await readRows(b.name, OUTBOX)).toHaveLength(1);
  });

  it("keeps the choice across a restart: both versions are still there to choose from", async () => {
    const { server, b, fromA, fromB } = await clash();
    b.store.lock();

    const restarted = await device(server, undefined, { name: b.name });

    expect(await listConflicts(restarted.store)).toEqual([
      { id: fromB.id, revision: 2, kind: "edited", mine: fromB, theirs: fromA },
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

    expect(await store.resolve("journal-entry", mine.id, "theirs", 2)).toBe(
      false,
    );
    expect(await store.get("journal-entry", mine.id)).toEqual(mine);

    store.park(mine.id, other);
    expect(await store.conflicts("journal-entry")).toEqual([
      { id: mine.id, mine, theirs: other, theirsDeleted: false, revision: 2 },
    ]);
    // A choice about a version that has since been replaced changes nothing.
    await expect(
      store.resolve("journal-entry", mine.id, "theirs", 1),
    ).rejects.toThrow(ConflictChangedError);
    expect(await store.get("journal-entry", mine.id)).toEqual(mine);
    expect(await store.resolve("journal-entry", mine.id, "mine", 2)).toBe(true);
    expect(await store.get("journal-entry", mine.id)).toEqual(mine);
    expect(await store.conflicts("journal-entry")).toEqual([]);

    store.park(mine.id, other, 7);
    await store.resolve("journal-entry", mine.id, "theirs", 7);
    expect(await store.get("journal-entry", mine.id)).toEqual(other);

    store.park(mine.id, mine);
    const merged = { ...mine, updatedAt: "2026-12-01T00:00:00.000Z" };
    await store.resolve("journal-entry", mine.id, "mine", 2, merged);
    expect(await store.get("journal-entry", mine.id)).toEqual(merged);

    store.park(mine.id, undefined);
    await expect(
      store.resolve("journal-entry", mine.id, "mine", 2),
    ).rejects.toThrow(RecordDeletedError);
    await store.resolve("journal-entry", mine.id, "theirs", 2);
    expect(await store.get("journal-entry", mine.id)).toBeUndefined();

    store.park(mine.id, other);
    store.lock();
    expect(await store.conflicts("journal-entry")).toEqual([]);
  });
});
