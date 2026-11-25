import { describe, expect, it } from "vitest";

import { importRootKey } from "../../../src/crypto/root-key";
import { createEventBus, type DomainEvents } from "../../../src/domain/events";
import { deleteEntry } from "../../../src/domain/journal/delete";
import { completedFrom, draftFrom } from "../../../src/domain/journal/drafts";
import { OUTBOX, RECORDS, type StoredRecord } from "../../../src/storage/db";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import type { OutboxOperation } from "../../../src/storage/outbox";
import { MemoryRecordStore } from "../../../src/storage/record-store";
import { readRows } from "../storage/idb-snapshot";

const CONTENT = {
  responses: {
    good: "CANARY-GONE what was written",
    improve: "Planning weekends.",
    loved: "A note on the fridge.",
  },
  feelings: ["calm"] as const,
};

function listening(events: ReturnType<typeof createEventBus>): {
  deleted: DomainEvents["journal.deleted"][];
  changed: DomainEvents["journal.changed"][];
} {
  const heard = {
    deleted: [] as DomainEvents["journal.deleted"][],
    changed: [] as DomainEvents["journal.changed"][],
  };
  events.on("journal.deleted", (event) => {
    heard.deleted.push(event);
  });
  events.on("journal.changed", (event) => {
    heard.changed.push(event);
  });
  return heard;
}

function rootKey(): Promise<Awaited<ReturnType<typeof importRootKey>>> {
  return importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i));
}

describe("deleting an entry for good (JR-007, AC-17)", () => {
  it("removes a completed entry and announces journal.deleted with its last hash", async () => {
    const records = new MemoryRecordStore();
    const events = createEventBus();
    const heard = listening(events);
    const entry = await completedFrom(CONTENT);
    const other = await completedFrom(CONTENT);
    await records.put("journal-entry", entry);
    await records.put("journal-entry", other);

    expect(await deleteEntry({ records, events }, entry.id)).toBe(true);

    expect(await records.list("journal-entry")).toEqual([other]);
    expect(heard.deleted).toEqual([
      { entryId: entry.id, oldHash: entry.contentHash },
    ]);
    expect(heard.changed).toEqual([]);
  });

  it("announces only after the entry is gone", async () => {
    const records = new MemoryRecordStore();
    const events = createEventBus();
    const entry = await completedFrom(CONTENT);
    await records.put("journal-entry", entry);
    let stillThere: boolean | undefined;
    events.on("journal.deleted", async () => {
      stillThere = (await records.get("journal-entry", entry.id)) !== undefined;
    });

    await deleteEntry({ records, events }, entry.id);

    expect(stillThere).toBe(false);
  });

  it("removes a draft without announcing anything: nothing was built from it", async () => {
    const records = new MemoryRecordStore();
    const events = createEventBus();
    const heard = listening(events);
    const draft = await draftFrom(CONTENT);
    await records.put("journal-entry", draft);

    expect(await deleteEntry({ records, events }, draft.id)).toBe(true);

    expect(await records.list("journal-entry")).toEqual([]);
    expect(heard.deleted).toEqual([]);
  });

  it("does nothing, and says so, when there is no such entry or it is already deleted", async () => {
    const records = new MemoryRecordStore();
    const events = createEventBus();
    const heard = listening(events);
    const entry = await completedFrom(CONTENT);
    await records.put("journal-entry", entry);
    await deleteEntry({ records, events }, entry.id);

    expect(await deleteEntry({ records, events }, entry.id)).toBe(false);
    expect(await deleteEntry({ records, events }, "never-there")).toBe(false);

    expect(heard.deleted).toHaveLength(1);
  });

  it("announces nothing when the deletion could not be stored", async () => {
    const records = new MemoryRecordStore();
    const events = createEventBus();
    const heard = listening(events);
    const entry = await completedFrom(CONTENT);
    await records.put("journal-entry", entry);
    records.delete = () => Promise.reject(new Error("synthetic"));

    await expect(deleteEntry({ records, events }, entry.id)).rejects.toThrow(
      "synthetic",
    );

    expect(heard.deleted).toEqual([]);
    expect(await records.get("journal-entry", entry.id)).toEqual(entry);
  });

  it("leaves a tombstone and no ciphertext, queues one delete, and stays gone after a reload", async () => {
    const name = `delete-test-${crypto.randomUUID()}`;
    const store = new EncryptedRecordStore(() => name);
    store.unlock(await rootKey(), "owner-1");
    const events = createEventBus();
    const entry = await completedFrom(CONTENT);
    const kept = await completedFrom({
      responses: { good: "Kept", improve: "Kept", loved: "Kept" },
      feelings: [],
    });
    await store.put("journal-entry", entry);
    await store.put("journal-entry", kept);

    await deleteEntry({ records: store, events }, entry.id);

    // The row is a tombstone: ID, type and revisions, and no ciphertext.
    const rows = await readRows<StoredRecord>(name, RECORDS);
    expect(rows.find((row) => row.id === entry.id)).toEqual({
      type: 1,
      id: entry.id,
      envelope: null,
      schemaVersion: 1,
      localRevision: 2,
      baseRevision: 0,
      tombstone: true,
      dirty: true,
    });
    // One delete is queued for the entry, after its creation.
    const operations = (await readRows<OutboxOperation>(name, OUTBOX)).filter(
      (operation) => operation.id === entry.id,
    );
    expect(operations.map((operation) => operation.tombstone)).toEqual([
      false,
      true,
    ]);
    expect(operations[1]?.localRevision).toBe(2);
    // Nothing of the entry is in memory any more.
    expect(await store.list("journal-entry")).toEqual([kept]);
    expect(await store.get("journal-entry", entry.id)).toBeUndefined();

    // After a reload the tombstone is still there and the entry is not.
    store.lock();
    const reloaded = new EncryptedRecordStore(() => name);
    reloaded.unlock(await rootKey(), "owner-1");
    expect(await reloaded.list("journal-entry")).toEqual([kept]);
    expect(await reloaded.unreadable("journal-entry")).toBe(0);
    expect(
      (await readRows<StoredRecord>(name, RECORDS)).find(
        (row) => row.id === entry.id,
      )?.tombstone,
    ).toBe(true);
    // Deleting again queues nothing more.
    expect(await deleteEntry({ records: reloaded, events }, entry.id)).toBe(
      false,
    );
    expect(await readRows(name, OUTBOX)).toHaveLength(3);
  });
});
