/**
 * An edit the person has not saved is kept on the device, encrypted, and
 * never becomes part of the entry or of sync (ADR-0015; PRD JR-006,
 * SYNC-001).
 */
import { describe, expect, it } from "vitest";

import { importRootKey, type RootKey } from "../../../src/crypto/root-key";
import { newEntry, type JournalEntry } from "../../../src/domain/journal/types";
import {
  isUnfinishedEdit,
  sameContent,
  type UnfinishedEdit,
} from "../../../src/domain/journal/unfinished";
import { OUTBOX, RECORDS, UNFINISHED } from "../../../src/storage/db";
import {
  EncryptedRecordStore,
  StoreLockedError,
} from "../../../src/storage/encrypted-record-store";
import {
  MemoryRecordStore,
  type RecordStore,
} from "../../../src/storage/record-store";

import { createEventBus } from "../../../src/domain/events";
import { completedFrom } from "../../../src/domain/journal/drafts";
import {
  discardMine,
  isDeletedElsewhere,
  listConflicts,
} from "../../../src/sync/conflicts";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { device, type Device } from "../sync/devices";

import { openRaw, readRows } from "./idb-snapshot";

const OWNER = "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90";
const CANARY = "CANARY unsaved words";

let databases = 0;

function rootKey(fill = 0): Promise<RootKey> {
  return importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i + fill));
}

function entry(good = "Synthetic answer"): Promise<JournalEntry> {
  return newEntry({ good, improve: "Synthetic two", loved: "Synthetic three" });
}

function editOf(saved: JournalEntry, good = CANARY): UnfinishedEdit {
  return {
    responses: { ...saved.responses, good },
    feelings: ["calm"],
    basedOn: saved.contentHash,
  };
}

async function encrypted(): Promise<{
  store: EncryptedRecordStore;
  name: string;
  names: (owner: string) => string;
}> {
  databases += 1;
  const prefix = `unfinished-test-${String(databases)}`;
  const names = (owner: string): string => `${prefix}-${owner}`;
  const store = new EncryptedRecordStore(names);
  store.unlock(await rootKey(), OWNER);
  return { store, name: names(OWNER), names };
}

/** Every string that can be made from a stored value, bytes included. */
function everythingIn(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    ArrayBuffer.isView(inner)
      ? new TextDecoder("latin1").decode(inner as Uint8Array)
      : inner,
  );
}

describe.each([
  [
    "in memory",
    (): Promise<RecordStore> => Promise.resolve(new MemoryRecordStore()),
  ],
  [
    "encrypted in IndexedDB",
    async (): Promise<RecordStore> => (await encrypted()).store,
  ],
])("an unsaved edit, kept %s", (_name, make) => {
  it("is given back as it was kept, and the entry is left exactly as it was", async () => {
    const store = await make();
    const saved = await entry();
    await store.put("journal-entry", saved);

    expect(await store.keepUnfinished(saved.id, editOf(saved))).toBe(true);

    expect(await store.unfinished(saved.id)).toEqual(editOf(saved));
    expect(await store.get("journal-entry", saved.id)).toEqual(saved);
    expect(await store.reload("journal-entry", saved.id)).toEqual(saved);
  });

  it("is replaced by a later one, and gone once dropped", async () => {
    const store = await make();
    const saved = await entry();
    await store.put("journal-entry", saved);
    await store.keepUnfinished(saved.id, editOf(saved, "first"));

    await store.keepUnfinished(saved.id, editOf(saved, "second"));
    expect((await store.unfinished(saved.id))?.responses.good).toBe("second");

    await store.dropUnfinished(saved.id);
    expect(await store.unfinished(saved.id)).toBeUndefined();
    // Dropping one that is not there does nothing.
    await store.dropUnfinished(saved.id);
  });

  it("is not kept for an entry that is not here, or that was deleted", async () => {
    const store = await make();
    const saved = await entry();

    expect(await store.keepUnfinished(saved.id, editOf(saved))).toBe(false);
    expect(await store.unfinished(saved.id)).toBeUndefined();

    await store.put("journal-entry", saved);
    await store.delete("journal-entry", saved.id);
    expect(await store.keepUnfinished(saved.id, editOf(saved))).toBe(false);
    expect(await store.unfinished(saved.id)).toBeUndefined();
  });

  it("goes with its entry when the entry is deleted", async () => {
    const store = await make();
    const saved = await entry();
    await store.put("journal-entry", saved);
    await store.keepUnfinished(saved.id, editOf(saved));

    await store.delete("journal-entry", saved.id);

    expect(await store.unfinished(saved.id)).toBeUndefined();
  });

  it("belongs to one entry and not another", async () => {
    const store = await make();
    const one = await entry("one");
    const two = await entry("two");
    await store.put("journal-entry", one);
    await store.put("journal-entry", two);

    await store.keepUnfinished(one.id, editOf(one));

    expect(await store.unfinished(two.id)).toBeUndefined();
  });
});

describe("an unsaved edit in IndexedDB (ADR-0015)", () => {
  it("is stored as an envelope and nothing readable: a canary is in no stored value", async () => {
    const { store, name } = await encrypted();
    const saved = await entry();
    await store.put("journal-entry", saved);

    await store.keepUnfinished(saved.id, editOf(saved));

    const rows = await readRows<Record<string, unknown>>(name, UNFINISHED);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "envelope",
      "id",
      "schemaVersion",
      "type",
    ]);
    for (const storeName of [UNFINISHED, RECORDS, OUTBOX]) {
      expect(
        everythingIn(await readRows(name, storeName)),
        storeName,
      ).not.toContain("CANARY");
    }
  });

  it("is never queued to be sent: keeping and dropping one add nothing to the outbox", async () => {
    const { store, name } = await encrypted();
    const saved = await entry();
    await store.put("journal-entry", saved);
    const queued = (await readRows(name, OUTBOX)).length;
    const row = (await readRows<{ localRevision: number }>(name, RECORDS))[0];

    await store.keepUnfinished(saved.id, editOf(saved));
    await store.dropUnfinished(saved.id);
    await store.keepUnfinished(saved.id, editOf(saved));

    expect(await readRows(name, OUTBOX)).toHaveLength(queued);
    expect((await store.pending()).length).toBe(1);
    // The entry's own row has not moved either.
    expect((await readRows(name, RECORDS))[0]).toEqual(row);
  });

  it("is still there after a lock and a reload, and cannot be read under another key", async () => {
    const { store, names } = await encrypted();
    const saved = await entry();
    await store.put("journal-entry", saved);
    await store.keepUnfinished(saved.id, editOf(saved));
    store.lock();

    const again = new EncryptedRecordStore(names);
    again.unlock(await rootKey(), OWNER);
    expect(await again.unfinished(saved.id)).toEqual(editOf(saved));
    again.lock();

    const other = new EncryptedRecordStore(names);
    other.unlock(await rootKey(7), OWNER);
    expect(await other.unfinished(saved.id)).toBeUndefined();
  });

  it("cannot be read as the entry, nor the entry as it: each has its own envelope type", async () => {
    const { store, name } = await encrypted();
    const saved = await entry();
    await store.put("journal-entry", saved);
    await store.keepUnfinished(saved.id, editOf(saved));
    // Swap the two envelopes on disk.
    const database = await openRaw(name);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [RECORDS, UNFINISHED],
        "readwrite",
      );
      const records = transaction.objectStore(RECORDS);
      const unfinished = transaction.objectStore(UNFINISHED);
      const reading = records.get([1, saved.id]);
      reading.onsuccess = () => {
        const recordRow = reading.result as { envelope: Uint8Array };
        const other = unfinished.get([1, saved.id]);
        other.onsuccess = () => {
          const editRow = other.result as { envelope: Uint8Array };
          records.put({ ...recordRow, envelope: editRow.envelope });
          unfinished.put({ ...editRow, envelope: recordRow.envelope });
        };
      };
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("swap failed"));
      };
    });
    database.close();

    expect(await store.unfinished(saved.id)).toBeUndefined();
    expect(await store.reload("journal-entry", saved.id)).toBeUndefined();
    expect(await store.unreadable("journal-entry")).toBe(1);
  });

  it("is not read, kept or dropped while locked", async () => {
    const { store } = await encrypted();
    const saved = await entry();
    await store.put("journal-entry", saved);
    await store.keepUnfinished(saved.id, editOf(saved));
    store.lock();

    expect(await store.unfinished(saved.id)).toBeUndefined();
    await expect(
      store.keepUnfinished(saved.id, editOf(saved)),
    ).rejects.toBeInstanceOf(StoreLockedError);
    await expect(store.dropUnfinished(saved.id)).rejects.toBeInstanceOf(
      StoreLockedError,
    );
  });
});

describe("an unsaved edit and a deletion made on another device (ADR-0015)", () => {
  /** Two devices that both hold one entry, the second with an unsaved edit. */
  async function twoDevices(): Promise<{
    a: Device;
    b: Device;
    saved: JournalEntry;
  }> {
    const server = new MemoryServer();
    const a = await device(server);
    const b = await device(server);
    const saved = await entry();
    await a.store.put("journal-entry", saved);
    await a.sync();
    await b.sync();
    expect(await b.store.keepUnfinished(saved.id, editOf(saved))).toBe(true);
    return { a, b, saved };
  }

  it("goes when the deletion arrives", async () => {
    const { a, b, saved } = await twoDevices();

    await a.store.delete("journal-entry", saved.id);
    await a.sync();
    await b.sync();

    expect(await b.store.unfinished(saved.id)).toBeUndefined();
    expect(await readRows(b.name, UNFINISHED)).toEqual([]);
  });

  it("stays while the person has not chosen, and goes when they let the entry go", async () => {
    const { a, b, saved } = await twoDevices();
    // The second device has also saved a change of its own, not yet sent.
    const mine = await completedFrom(
      { responses: { ...saved.responses, good: "Changed here" }, feelings: [] },
      saved,
    );
    await b.store.put("journal-entry", mine);

    await a.store.delete("journal-entry", saved.id);
    await a.sync();
    await b.sync();

    // Both versions are waiting for a choice; nothing was removed for them.
    const [conflict] = await listConflicts(b.store);
    if (conflict === undefined || !isDeletedElsewhere(conflict)) {
      throw new Error("a deletion made elsewhere is expected");
    }
    expect(await readRows(b.name, UNFINISHED)).toHaveLength(1);

    await discardMine({ records: b.store, events: createEventBus() }, conflict);

    expect(await readRows(b.name, UNFINISHED)).toEqual([]);
  });
});

describe("what an unsaved edit is", () => {
  it("has three answers, feelings from the list, and the hash it started from", async () => {
    const saved = await entry();

    expect(isUnfinishedEdit(editOf(saved))).toBe(true);
    for (const wrong of [
      null,
      "text",
      {},
      { ...editOf(saved), basedOn: "" },
      { ...editOf(saved), basedOn: 3 },
      { ...editOf(saved), responses: { good: "a", improve: "b" } },
      { ...editOf(saved), responses: null },
      { ...editOf(saved), feelings: ["furious"] },
      { ...editOf(saved), feelings: "calm" },
    ]) {
      expect(isUnfinishedEdit(wrong), JSON.stringify(wrong)).toBe(false);
    }
  });

  it("is the same content as the entry only when every answer and feeling matches", async () => {
    const saved = await entry();
    const content = {
      responses: saved.responses,
      feelings: ["calm", "sad"] as const,
    };

    expect(
      sameContent(content, { ...content, feelings: ["sad", "calm"] }),
    ).toBe(true);
    expect(sameContent(content, { ...content, feelings: ["calm"] })).toBe(
      false,
    );
    expect(
      sameContent(content, { ...content, feelings: ["calm", "tired"] }),
    ).toBe(false);
    expect(
      sameContent(content, {
        ...content,
        responses: { ...saved.responses, loved: "changed" },
      }),
    ).toBe(false);
  });
});
