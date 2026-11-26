import { afterEach, describe, expect, it, vi } from "vitest";

import { sealJson } from "../../../src/crypto/envelope";
import { importRootKey, type RootKey } from "../../../src/crypto/root-key";
import { newEntry, type JournalEntry } from "../../../src/domain/journal/types";
import { StorageUnavailableError } from "../../../src/storage/errors";
import {
  NewerDatabaseError,
  META,
  OUTBOX,
  PARKED,
  RECORDS,
  type StoredRecord,
} from "../../../src/storage/db";
import {
  EncryptedRecordStore,
  RecordDeletedError,
  StaleRecordError,
  StoreLockedError,
} from "../../../src/storage/encrypted-record-store";
import type { OutboxOperation } from "../../../src/storage/outbox";

import { openRaw, readRows } from "./idb-snapshot";

const OWNER = "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90";
const JOURNAL_TYPE = 1;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let databases = 0;

/** A database-name function no other test shares. */
function freshNames(): (owner: string) => string {
  databases += 1;
  const prefix = `store-test-${String(databases)}`;
  return (owner) => `${prefix}-${owner}`;
}

function rootKey(fill = 0): Promise<RootKey> {
  return importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i + fill));
}

function entry(good = "Synthetic answer"): Promise<JournalEntry> {
  return newEntry({ good, improve: "Synthetic two", loved: "Synthetic three" });
}

/** A store that is unlocked, and the name of the database it writes. */
async function unlockedStore(): Promise<{
  store: EncryptedRecordStore;
  names: (owner: string) => string;
  name: string;
  root: RootKey;
}> {
  const names = freshNames();
  const store = new EncryptedRecordStore(names);
  const root = await rootKey();
  store.unlock(root, OWNER);
  return { store, names, name: names(OWNER), root };
}

async function addRow(name: string, row: StoredRecord): Promise<void> {
  const database = await openRaw(name);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(RECORDS, "readwrite");
    transaction.objectStore(RECORDS).put(row);
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("write failed"));
    };
  });
  database.close();
}

function rowFor(
  id: string,
  envelope: Uint8Array<ArrayBuffer>,
  overrides: Partial<StoredRecord> = {},
): StoredRecord {
  return {
    type: JOURNAL_TYPE,
    id,
    envelope,
    schemaVersion: 1,
    localRevision: 1,
    baseRevision: 0,
    tombstone: false,
    dirty: true,
    ...overrides,
  };
}

/** Every string that can be made from a stored value, bytes included. */
function everythingIn(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    ArrayBuffer.isView(inner)
      ? new TextDecoder("latin1").decode(inner as Uint8Array)
      : inner,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the encrypted record store", () => {
  it("returns what was put, by ID and in the list", async () => {
    const { store } = await unlockedStore();
    const written = await entry();

    await store.put("journal-entry", written);

    expect(await store.get("journal-entry", written.id)).toEqual(written);
    expect(await store.list("journal-entry")).toEqual([written]);
    expect(await store.unreadable("journal-entry")).toBe(0);
  });

  it("writes no plaintext to IndexedDB: a canary is in no stored value (SEC, AC-03)", async () => {
    const { store, name } = await unlockedStore();
    const canary = "CANARY-7f3a-private-sentence";
    const written = await newEntry({
      good: canary,
      improve: `${canary} again`,
      loved: canary,
    });

    await store.put("journal-entry", written);
    await store.put("journal-entry", { ...written, feelings: ["overwhelmed"] });
    await store.delete("journal-entry", (await entryIn(store)).id);

    const database = await openRaw(name);
    const storeNames = [...database.objectStoreNames];
    database.close();
    expect(storeNames.sort()).toEqual([META, OUTBOX, PARKED, RECORDS].sort());
    for (const storeName of storeNames) {
      const stored = everythingIn(await readRows(name, storeName));
      expect(stored).not.toContain("CANARY");
      expect(stored).not.toContain("overwhelmed");
      expect(stored).not.toContain(written.contentHash);
    }
  });

  it("stores each record as an envelope beside plain sync metadata only", async () => {
    const { store, name } = await unlockedStore();
    const written = await entry();

    await store.put("journal-entry", written);

    const [row] = await readRows<StoredRecord>(name, RECORDS);
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        "baseRevision",
        "dirty",
        "envelope",
        "id",
        "localRevision",
        "schemaVersion",
        "tombstone",
        "type",
      ].sort(),
    );
    expect(row).toMatchObject({
      type: JOURNAL_TYPE,
      id: written.id,
      schemaVersion: 1,
      localRevision: 1,
      baseRevision: 0,
      tombstone: false,
      dirty: true,
    });
    expect(row?.envelope?.[0]).toBe(1);
  });

  it("restores the records after a reload, once unlocked again", async () => {
    const { store, names, root } = await unlockedStore();
    const first = await entry("Synthetic first");
    const second = await entry("Synthetic second");
    await store.put("journal-entry", first);
    await store.put("journal-entry", second);
    store.lock();

    const reloaded = new EncryptedRecordStore(names);
    expect(await reloaded.list("journal-entry")).toEqual([]);
    reloaded.unlock(root, OWNER);

    const found = await reloaded.list("journal-entry");
    expect(found).toHaveLength(2);
    expect(found).toEqual(expect.arrayContaining([first, second]));
    expect(await reloaded.get("journal-entry", first.id)).toEqual(first);
  });

  it("holds nothing decrypted once locked, and refuses to write", async () => {
    const { store, name } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);
    const told = vi.fn();
    store.subscribe(told);

    store.lock();

    expect(told).toHaveBeenCalledTimes(1);
    expect(await store.get("journal-entry", written.id)).toBeUndefined();
    expect(await store.list("journal-entry")).toEqual([]);
    expect(await store.unreadable("journal-entry")).toBe(0);
    await expect(store.put("journal-entry", await entry())).rejects.toThrow(
      StoreLockedError,
    );
    await expect(store.delete("journal-entry", written.id)).rejects.toThrow(
      StoreLockedError,
    );
    // The ciphertext stays for the next unlock.
    expect(await readRows(name, RECORDS)).toHaveLength(1);
    expect(await readRows(name, OUTBOX)).toHaveLength(1);
  });

  it("writes nothing when the app locks while a record is being encrypted", async () => {
    const { store, name } = await unlockedStore();
    await store.list("journal-entry");
    const written = await entry();

    const saving = store.put("journal-entry", written);
    store.lock();

    await expect(saving).rejects.toThrow(StoreLockedError);
    expect(await readRows(name, RECORDS)).toEqual([]);
    expect(await readRows(name, OUTBOX)).toEqual([]);
  });

  it("drops a read that was waiting when the app locked", async () => {
    const { store, name, root } = await unlockedStore();
    await store.put("journal-entry", await entry());
    store.lock();

    store.unlock(root, OWNER);
    const reading = store.list("journal-entry");
    store.lock();

    expect(await reading).toEqual([]);
    expect(await readRows(name, RECORDS)).toHaveLength(1);
  });

  it("queues one operation per change, each with a fresh ID, in order (SYNC-002)", async () => {
    const { store, name } = await unlockedStore();
    const written = await entry();

    await store.put("journal-entry", written);
    await store.put("journal-entry", { ...written, status: "draft" });
    await store.delete("journal-entry", written.id);

    const operations = await readRows<OutboxOperation>(name, OUTBOX);
    expect(operations.map((operation) => operation.localRevision)).toEqual([
      1, 2, 3,
    ]);
    expect(operations.map((operation) => operation.tombstone)).toEqual([
      false,
      false,
      true,
    ]);
    expect(operations.map((operation) => operation.seq)).toEqual(
      [...operations.map((operation) => operation.seq)].sort((a, b) => a - b),
    );
    for (const operation of operations) {
      expect(operation).toMatchObject({
        type: JOURNAL_TYPE,
        id: written.id,
        baseRevision: 0,
        schemaVersion: 1,
      });
      expect(operation.opId).toMatch(UUID);
      expect(Object.keys(operation).sort()).toEqual(
        [
          "baseRevision",
          "id",
          "localRevision",
          "opId",
          "schemaVersion",
          "seq",
          "tombstone",
          "type",
        ].sort(),
      );
    }
    expect(new Set(operations.map((operation) => operation.opId)).size).toBe(3);
  });

  it("keeps a deletion as a tombstone with no ciphertext, and hides the record", async () => {
    const { store, names, name, root } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);
    const told = vi.fn();
    store.subscribe(told);

    await store.delete("journal-entry", written.id);

    expect(told).toHaveBeenCalledTimes(1);
    expect(await store.get("journal-entry", written.id)).toBeUndefined();
    expect(await readRows<StoredRecord>(name, RECORDS)).toEqual([
      {
        type: JOURNAL_TYPE,
        id: written.id,
        envelope: null,
        schemaVersion: 1,
        localRevision: 2,
        baseRevision: 0,
        tombstone: true,
        dirty: true,
      },
    ]);

    store.lock();
    const reloaded = new EncryptedRecordStore(names);
    reloaded.unlock(root, OWNER);
    expect(await reloaded.list("journal-entry")).toEqual([]);
    expect(await reloaded.unreadable("journal-entry")).toBe(0);
  });

  it("does nothing when asked to delete what is not there, or is already deleted", async () => {
    const { store, name } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);
    await store.delete("journal-entry", written.id);
    const told = vi.fn();
    store.subscribe(told);

    await store.delete("journal-entry", written.id);
    await store.delete("journal-entry", crypto.randomUUID());

    expect(told).not.toHaveBeenCalled();
    expect(await readRows(name, OUTBOX)).toHaveLength(2);
    expect(await readRows(name, RECORDS)).toHaveLength(1);
  });

  it("refuses to write over a deleted record, so a deletion cannot be undone by accident", async () => {
    const { store, name } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);
    await store.delete("journal-entry", written.id);
    const before = await readRows(name, RECORDS);

    await expect(store.put("journal-entry", written)).rejects.toThrow(
      RecordDeletedError,
    );

    expect(await store.get("journal-entry", written.id)).toBeUndefined();
    expect(await readRows(name, RECORDS)).toEqual(before);
    expect(await readRows(name, OUTBOX)).toHaveLength(2);
  });

  it("stores neither the record nor the operation when the transaction fails", async () => {
    const { store, name } = await unlockedStore();
    const kept = await entry("Synthetic kept");
    await store.put("journal-entry", kept);
    const written = await entry();
    const told = vi.fn();
    store.subscribe(told);
    // The operation is the second write of the transaction: failing it must
    // undo the first.
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new Error("synthetic failure");
    });

    await expect(store.put("journal-entry", written)).rejects.toThrow();
    await expect(
      store.put("journal-entry", { ...kept, status: "draft" }),
    ).rejects.toThrow();
    await expect(store.delete("journal-entry", kept.id)).rejects.toThrow();
    vi.restoreAllMocks();

    expect(told).not.toHaveBeenCalled();
    expect(await store.list("journal-entry")).toEqual([kept]);
    expect(await readRows<StoredRecord>(name, RECORDS)).toMatchObject([
      { id: kept.id, localRevision: 1, tombstone: false },
    ]);
    expect(await readRows(name, OUTBOX)).toHaveLength(1);
  });

  it("refuses a write based on a copy another tab has since changed, and keeps the newer record (invariant 5)", async () => {
    const { store: first, names, name, root } = await unlockedStore();
    const written = await entry("Synthetic original");
    await first.put("journal-entry", written);
    const second = new EncryptedRecordStore(names);
    second.unlock(root, OWNER);
    await second.list("journal-entry");
    const newer = { ...written, status: "draft" as const };
    await first.put("journal-entry", newer);
    const told = vi.fn();
    second.subscribe(told);

    await expect(
      second.put("journal-entry", { ...written, feelings: ["sad"] }),
    ).rejects.toThrow(StaleRecordError);

    expect(told).not.toHaveBeenCalled();
    expect(await readRows<StoredRecord>(name, RECORDS)).toMatchObject([
      { id: written.id, localRevision: 2 },
    ]);
    expect(await readRows(name, OUTBOX)).toHaveLength(2);
    // After unlocking again the second tab sees the newer record and can
    // change it.
    second.lock();
    second.unlock(root, OWNER);
    expect(await second.get("journal-entry", written.id)).toEqual(newer);
    await second.put("journal-entry", { ...newer, feelings: ["sad"] });
    expect(await readRows<StoredRecord>(name, RECORDS)).toMatchObject([
      { localRevision: 3 },
    ]);
  });

  it("reads one record again, so a refused write can be redone on the newer version", async () => {
    const { store: first, names, name, root } = await unlockedStore();
    const written = await entry("Synthetic original");
    await first.put("journal-entry", written);
    const second = new EncryptedRecordStore(names);
    second.unlock(root, OWNER);
    await second.list("journal-entry");
    const newer = { ...written, status: "draft" as const };
    await first.put("journal-entry", newer);
    const told = vi.fn();
    second.subscribe(told);

    expect(await second.reload("journal-entry", written.id)).toEqual(newer);

    expect(told).toHaveBeenCalledTimes(1);
    expect(await second.get("journal-entry", written.id)).toEqual(newer);
    await second.put("journal-entry", { ...newer, feelings: ["sad"] });
    expect(await readRows<StoredRecord>(name, RECORDS)).toMatchObject([
      { localRevision: 3 },
    ]);
  });

  it("on reading again, drops a record another tab deleted and picks up one it created", async () => {
    const { store: first, names, root } = await unlockedStore();
    const gone = await entry("Synthetic gone");
    await first.put("journal-entry", gone);
    const second = new EncryptedRecordStore(names);
    second.unlock(root, OWNER);
    await second.list("journal-entry");
    await first.delete("journal-entry", gone.id);
    const fresh = await entry("Synthetic fresh");
    await first.put("journal-entry", fresh);

    expect(await second.reload("journal-entry", gone.id)).toBeUndefined();
    expect(await second.reload("journal-entry", fresh.id)).toEqual(fresh);
    expect(await second.reload("journal-entry", "never-there")).toBeUndefined();

    expect(await second.list("journal-entry")).toEqual([fresh]);
  });

  it("on reading again, counts a record it can no longer read and hides it", async () => {
    const { store, name } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);
    const [row] = await readRows<StoredRecord>(name, RECORDS);
    if (row === undefined) {
      throw new Error("the row is expected");
    }
    await addRow(name, { ...row, schemaVersion: 2, localRevision: 2 });

    expect(await store.reload("journal-entry", written.id)).toBeUndefined();

    expect(await store.list("journal-entry")).toEqual([]);
    expect(await store.unreadable("journal-entry")).toBe(1);
  });

  it("reads nothing again while locked, or when locked meanwhile", async () => {
    const { store, root } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);

    const reading = store.reload("journal-entry", written.id);
    store.lock();

    expect(await reading).toBeUndefined();
    expect(await store.reload("journal-entry", written.id)).toBeUndefined();
    store.unlock(root, OWNER);
    expect(await store.reload("journal-entry", written.id)).toEqual(written);
  });

  it("refuses to create a record another tab already created with the same ID", async () => {
    const { store: first, names, name, root } = await unlockedStore();
    const second = new EncryptedRecordStore(names);
    second.unlock(root, OWNER);
    await second.list("journal-entry");
    const written = await entry();
    await first.put("journal-entry", written);

    await expect(second.put("journal-entry", written)).rejects.toThrow(
      StaleRecordError,
    );

    expect(await readRows(name, OUTBOX)).toHaveLength(1);
  });

  it("keeps each account's records in its own database", async () => {
    const { store, names, root } = await unlockedStore();
    await store.put("journal-entry", await entry());
    store.lock();

    const other = new EncryptedRecordStore(names);
    other.unlock(root, "another-owner");

    expect(await other.list("journal-entry")).toEqual([]);
    expect(names("another-owner")).not.toBe(names(OWNER));
  });

  it("starts again cleanly when unlocked for another account without locking first", async () => {
    const { store, root } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);

    store.unlock(root, "another-owner");

    expect(await store.list("journal-entry")).toEqual([]);
    store.unlock(root, OWNER);
    expect(await store.list("journal-entry")).toEqual([written]);
  });
});

async function entryIn(store: EncryptedRecordStore): Promise<JournalEntry> {
  const [found] = await store.list("journal-entry");
  if (found === undefined) {
    throw new Error("the store is empty");
  }
  return found;
}

describe("records the store knows were deleted (SYNC-006)", () => {
  it("lists a deletion made here, by kind, and nothing that was never here", async () => {
    const { store } = await unlockedStore();
    const [kept, removed] = [await entry("Kept"), await entry("Removed")];
    await store.put("journal-entry", kept);
    await store.put("journal-entry", removed);
    expect(await store.deleted("journal-entry")).toEqual([]);

    await store.delete("journal-entry", removed.id);
    await store.delete("journal-entry", "00000000-0000-4000-8000-00000000dead");

    expect(await store.deleted("journal-entry")).toEqual([removed.id]);
    expect(await store.deleted("reflect-session")).toEqual([]);
  });

  it("still knows after the app has been locked and opened again", async () => {
    const { store, names, root } = await unlockedStore();
    const removed = await entry("Removed");
    await store.put("journal-entry", removed);
    await store.delete("journal-entry", removed.id);
    store.lock();
    expect(await store.deleted("journal-entry")).toEqual([]);

    const again = new EncryptedRecordStore(names);
    again.unlock(root, OWNER);

    expect(await again.deleted("journal-entry")).toEqual([removed.id]);
  });
});

describe("records the store cannot read are left alone and counted (§13.6)", () => {
  it("under another key", async () => {
    const { store, names, name } = await unlockedStore();
    await store.put("journal-entry", await entry());
    store.lock();
    const before = await readRows(name, RECORDS);

    const other = new EncryptedRecordStore(names);
    other.unlock(await rootKey(1), OWNER);

    expect(await other.list("journal-entry")).toEqual([]);
    expect(await other.unreadable("journal-entry")).toBe(1);
    expect(await readRows(name, RECORDS)).toEqual(before);
  });

  it("written in a newer shape, with the wrong shape, under another ID, or in an unknown envelope format", async () => {
    const { store, names, name, root } = await unlockedStore();
    const good = await entry();
    await store.put("journal-entry", good);
    store.lock();
    const seal = (id: string, value: unknown) =>
      sealJson(root, { owner: OWNER, recordId: id, type: JOURNAL_TYPE }, value);
    const newer = await entry();
    const moved = await entry();
    const unknownFormat = await seal("unknown-format", good);
    unknownFormat[0] = 9;
    await addRow(
      name,
      rowFor(newer.id, await seal(newer.id, newer), { schemaVersion: 2 }),
    );
    await addRow(name, rowFor("misshapen", await seal("misshapen", {})));
    await addRow(name, rowFor("elsewhere", await seal("elsewhere", moved)));
    await addRow(name, rowFor("unknown-format", unknownFormat));
    // A type this version of the app does not know is not a journal entry.
    await addRow(
      name,
      rowFor("future-kind", await seal("future-kind", good), { type: 200 }),
    );

    const reloaded = new EncryptedRecordStore(names);
    reloaded.unlock(root, OWNER);

    expect(await reloaded.list("journal-entry")).toEqual([good]);
    expect(await reloaded.unreadable("journal-entry")).toBe(4);
    expect(await readRows(name, RECORDS)).toHaveLength(6);
  });

  it("is never written over: a put with the same ID is refused and the row stays as it was", async () => {
    const { store, names, name } = await unlockedStore();
    const written = await entry();
    await store.put("journal-entry", written);
    store.lock();
    const before = await readRows(name, RECORDS);
    const other = new EncryptedRecordStore(names);
    other.unlock(await rootKey(1), OWNER);
    expect(await other.unreadable("journal-entry")).toBe(1);

    await expect(other.put("journal-entry", written)).rejects.toThrow(
      StaleRecordError,
    );

    expect(await other.unreadable("journal-entry")).toBe(1);
    expect(await readRows(name, RECORDS)).toEqual(before);
    expect(await readRows(name, OUTBOX)).toHaveLength(1);
  });

  it("stops counting one once it is deleted", async () => {
    const { store, names, name, root } = await unlockedStore();
    await store.list("journal-entry");
    store.lock();
    await addRow(
      name,
      rowFor(
        "misshapen",
        await sealJson(
          root,
          { owner: OWNER, recordId: "misshapen", type: JOURNAL_TYPE },
          {},
        ),
      ),
    );
    const reloaded = new EncryptedRecordStore(names);
    reloaded.unlock(root, OWNER);
    expect(await reloaded.unreadable("journal-entry")).toBe(1);

    await reloaded.delete("journal-entry", "misshapen");

    expect(await reloaded.unreadable("journal-entry")).toBe(0);
    expect(await readRows<StoredRecord>(name, RECORDS)).toMatchObject([
      { id: "misshapen", tombstone: true, envelope: null, localRevision: 2 },
    ]);
  });
});

describe("a database this code must not touch (§13.6)", () => {
  it("fails every read and write when a newer version of the app wrote it", async () => {
    const names = freshNames();
    await new Promise<void>((resolve) => {
      const opening = indexedDB.open(names(OWNER), 99);
      opening.onsuccess = () => {
        opening.result.close();
        resolve();
      };
    });
    const store = new EncryptedRecordStore(names);
    store.unlock(await rootKey(), OWNER);

    await expect(store.list("journal-entry")).rejects.toThrow(
      NewerDatabaseError,
    );
    await expect(store.get("journal-entry", "any")).rejects.toThrow(
      NewerDatabaseError,
    );
    await expect(store.put("journal-entry", await entry())).rejects.toThrow(
      NewerDatabaseError,
    );
    const database = await openRaw(names(OWNER));
    expect(database.version).toBe(99);
    expect([...database.objectStoreNames]).toEqual([]);
    database.close();
    // Locking after a failed open is safe.
    store.lock();
    expect(await store.list("journal-entry")).toEqual([]);
  });

  it("lets a newer version upgrade the database, and then refuses to write", async () => {
    const { store, name } = await unlockedStore();
    await store.put("journal-entry", await entry());

    await new Promise<void>((resolve, reject) => {
      const upgrading = indexedDB.open(name, 99);
      upgrading.onblocked = () => {
        reject(new Error("the upgrade was blocked"));
      };
      upgrading.onsuccess = () => {
        upgrading.result.close();
        resolve();
      };
    });

    // The failure says a newer version is in use, so the person is told to
    // reload, not sent looking for a private window.
    await expect(
      store.put("journal-entry", await entry()),
    ).rejects.toBeInstanceOf(NewerDatabaseError);
    await expect(store.delete("journal-entry", "any")).rejects.toBeInstanceOf(
      NewerDatabaseError,
    );
    await expect(store.reload("journal-entry", "any")).rejects.toBeInstanceOf(
      NewerDatabaseError,
    );
    expect(await readRows(name, RECORDS)).toHaveLength(1);
  });

  it("is unavailable, not superseded, when the database is deleted under it", async () => {
    const { store, name } = await unlockedStore();
    await store.put("journal-entry", await entry());

    await new Promise<void>((resolve, reject) => {
      const removing = indexedDB.deleteDatabase(name);
      removing.onsuccess = () => {
        resolve();
      };
      removing.onblocked = () => {
        reject(new Error("the deletion was blocked"));
      };
    });

    await expect(
      store.put("journal-entry", await entry()),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
