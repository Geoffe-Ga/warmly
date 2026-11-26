import { afterEach, describe, expect, it, vi } from "vitest";

import { importRootKey } from "../../../src/crypto/root-key";
import type { JournalEntry } from "../../../src/domain/journal/types";
import type { UnfinishedEdit } from "../../../src/domain/journal/unfinished";
import {
  StorageBlockedError,
  StorageError,
  StorageFullError,
  StorageUnavailableError,
} from "../../../src/storage/errors";
import {
  DB_VERSION,
  NewerDatabaseError,
  META,
  OUTBOX,
  PARKED,
  RECORDS,
  UNFINISHED,
  openRecordsDatabase,
  recordsDatabaseName,
  transact,
} from "../../../src/storage/db";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import { readOutbox, type OutboxOperation } from "../../../src/storage/outbox";

import {
  dumpDatabase,
  readRows,
  restoreDatabase,
  type DatabaseSnapshot,
} from "./idb-snapshot";

interface SnapshotFile {
  readonly owner: string;
  readonly database: DatabaseSnapshot;
  readonly expected: {
    readonly "journal-entry": readonly JournalEntry[];
    readonly deleted: readonly string[];
    /** Unsaved edits the snapshot holds, by entry ID (from version 3). */
    readonly unfinished?: Readonly<Record<string, UnfinishedEdit>>;
  };
}

// Every committed snapshot, keyed by its directory name: "v1", "v2", ...
const SNAPSHOTS = new Map(
  Object.entries(
    import.meta.glob<SnapshotFile>("../../fixtures/idb/*/snapshot.json", {
      eager: true,
      import: "default",
    }),
  ).map(([path, file]) => [path.split("/").at(-2) ?? "", file]),
);

function snapshotVersions(): string[] {
  return [...SNAPSHOTS.keys()].sort();
}

function readSnapshot(version: string): SnapshotFile {
  const snapshot = SNAPSHOTS.get(version);
  if (snapshot === undefined) {
    throw new Error(`There is no committed snapshot ${version}`);
  }
  return snapshot;
}

let databases = 0;

function freshName(): string {
  databases += 1;
  return `db-test-${String(databases)}`;
}

describe("the local database schema", () => {
  it("names a database per account", () => {
    expect(recordsDatabaseName("owner-1")).toBe("warmly-records-owner-1");
    expect(recordsDatabaseName("owner-1", "tab-9")).toBe(
      "tab-9-records-owner-1",
    );
  });

  it("creates the current schema from nothing", async () => {
    const name = freshName();

    const database = await openRecordsDatabase(name);
    database.close();

    expect(await dumpDatabase(name)).toEqual({
      version: DB_VERSION,
      stores: {
        [META]: { keyPath: "key", autoIncrement: false, rows: [] },
        [OUTBOX]: { keyPath: "seq", autoIncrement: true, rows: [] },
        [PARKED]: { keyPath: ["type", "id"], autoIncrement: false, rows: [] },
        [RECORDS]: { keyPath: ["type", "id"], autoIncrement: false, rows: [] },
        [UNFINISHED]: {
          keyPath: ["type", "id"],
          autoIncrement: false,
          rows: [],
        },
      },
    });
  });

  it("changes nothing when an up-to-date database is opened again", async () => {
    const name = freshName();
    await restoreDatabase(
      name,
      readSnapshot(`v${String(DB_VERSION)}`).database,
    );
    const before = await dumpDatabase(name);

    (await openRecordsDatabase(name)).close();
    (await openRecordsDatabase(name)).close();

    expect(await dumpDatabase(name)).toEqual(before);
  });

  it("has a committed snapshot for every schema version up to the current one", () => {
    expect(snapshotVersions()).toEqual(
      Array.from({ length: DB_VERSION }, (_, index) => `v${String(index + 1)}`),
    );
  });

  it.each(snapshotVersions())(
    "upgrades the %s snapshot and still reads every record",
    async (version) => {
      const snapshot = readSnapshot(version);
      const name = freshName();
      await restoreDatabase(name, snapshot.database);
      const store = new EncryptedRecordStore(() => name);
      store.unlock(
        await importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i)),
        snapshot.owner,
      );

      const found = await store.list("journal-entry");

      expect(found).toHaveLength(snapshot.expected["journal-entry"].length);
      expect(found).toEqual(
        expect.arrayContaining([...snapshot.expected["journal-entry"]]),
      );
      expect(await store.unreadable("journal-entry")).toBe(0);
      for (const id of snapshot.expected.deleted) {
        expect(await store.get("journal-entry", id)).toBeUndefined();
      }
      // An unsaved edit is still read, and an older snapshot has none.
      const unfinished = snapshot.expected.unfinished ?? {};
      for (const each of snapshot.expected["journal-entry"]) {
        expect(await store.unfinished(each.id)).toEqual(unfinished[each.id]);
      }
      store.lock();
      const upgraded = await dumpDatabase(name);
      expect(upgraded.version).toBe(DB_VERSION);
      // The queue of unsent changes survives the upgrade, in order.
      expect(
        (await readRows<OutboxOperation>(name, OUTBOX)).map(
          (operation) => operation.opId,
        ),
      ).toEqual(
        snapshot.database.stores[OUTBOX]?.rows.map((row) => row["opId"]),
      );
    },
  );

  it("refuses a database written by a newer version, and leaves it as it was", async () => {
    const name = freshName();
    await restoreDatabase(name, { version: DB_VERSION + 1, stores: {} });

    await expect(openRecordsDatabase(name)).rejects.toThrow(NewerDatabaseError);

    expect(await dumpDatabase(name)).toEqual({
      version: DB_VERSION + 1,
      stores: {},
    });
  });
});

describe("a database that cannot be opened", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function failingOpen(error: DOMException | null): void {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = { error } as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onerror?.(new Event("error"));
      });
      return request;
    });
  }

  it.each([
    ["QuotaExceededError", StorageFullError, "full"],
    ["VersionError", NewerDatabaseError, "newer"],
    ["UnknownError", StorageUnavailableError, "unavailable"],
    ["SecurityError", StorageUnavailableError, "unavailable"],
  ] as const)(
    "turns the browser's %s into a typed error",
    async (name, type, kind) => {
      failingOpen(new DOMException("synthetic", name));

      const failure = await openRecordsDatabase(freshName()).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(type);
      expect(failure).toBeInstanceOf(StorageError);
      expect((failure as StorageError).kind).toBe(kind);
      // Nothing of the browser's own text is carried along.
      expect((failure as Error).message).not.toContain("synthetic");
    },
  );

  it("is unavailable when the browser gives no reason", async () => {
    failingOpen(null);

    await expect(openRecordsDatabase(freshName())).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
  });

  it("is unavailable when the browser has no database, or refuses to open one at all", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("synthetic", "SecurityError");
    });

    await expect(openRecordsDatabase(freshName())).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
  });

  it("gives up as blocked when another tab holds an older version open, and lets go when that tab does", async () => {
    const name = freshName();
    // Another tab has version 0 of the database open and ignores requests
    // to close it.
    const other = await new Promise<IDBDatabase>((resolve) => {
      const opening = indexedDB.open(name);
      opening.onsuccess = () => {
        resolve(opening.result);
      };
    });
    await new Promise<void>((resolve) => {
      other.close();
      const downgrade = indexedDB.deleteDatabase(name);
      downgrade.onsuccess = () => {
        resolve();
      };
    });
    const holder = await new Promise<IDBDatabase>((resolve) => {
      const opening = indexedDB.open(name, 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("placeholder");
      };
      opening.onsuccess = () => {
        resolve(opening.result);
      };
    });
    const original = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, "open").mockImplementation((...args) =>
      // Ask for a newer version than the holder has, as an upgrade would.
      original(args[0], 2),
    );

    await expect(openRecordsDatabase(name)).rejects.toBeInstanceOf(
      StorageBlockedError,
    );

    // When the other tab closes, the abandoned open finishes and is closed
    // again, so nothing is left holding the database.
    holder.close();
    vi.restoreAllMocks();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise<void>((resolve, reject) => {
      const removing = indexedDB.deleteDatabase(name);
      removing.onsuccess = () => {
        resolve();
      };
      removing.onblocked = () => {
        reject(new Error("the abandoned open still holds the database"));
      };
    });
  });
});

describe("a transaction", () => {
  it("fails with an error even when the work throws something else", async () => {
    const database = await openRecordsDatabase(freshName());

    await expect(
      transact(database, [RECORDS], "readwrite", () => {
        const notAnError: unknown = "synthetic";
        throw notAnError;
      }),
    ).rejects.toThrow("The write was abandoned");

    database.close();
  });

  it("resolves with what the work reported, after it has committed", async () => {
    const database = await openRecordsDatabase(freshName());

    const value = await transact<string>(
      database,
      [RECORDS],
      "readwrite",
      (transaction, result) => {
        transaction.objectStore(RECORDS).put({ type: 1, id: "a" });
        result("done");
      },
    );

    expect(value).toBe("done");
    expect(await readRows(database.name, RECORDS)).toHaveLength(1);
    database.close();
  });

  it("fails when the work never reports a result, so a forgotten report cannot pass as success", async () => {
    const database = await openRecordsDatabase(freshName());

    await expect(
      transact(database, [RECORDS], "readonly", () => undefined),
    ).rejects.toThrow("The transaction reported no result");

    database.close();
  });

  it("reports a full device as a typed error, and stores nothing", async () => {
    const database = await openRecordsDatabase(freshName());
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("synthetic", "QuotaExceededError");
    });

    await expect(
      transact(database, [RECORDS], "readwrite", (transaction, result) => {
        transaction.objectStore(RECORDS).put({ type: 1, id: "a" });
        result(undefined);
      }),
    ).rejects.toBeInstanceOf(StorageFullError);

    vi.restoreAllMocks();
    expect(await readRows(database.name, RECORDS)).toEqual([]);
    database.close();
  });

  it("reports a database closed under it as unavailable", async () => {
    const database = await openRecordsDatabase(freshName());
    database.close();

    await expect(
      transact(database, [RECORDS], "readonly", (_transaction, result) => {
        result(undefined);
      }),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("stores nothing when the work throws", async () => {
    const database = await openRecordsDatabase(freshName());

    await expect(
      transact(database, [RECORDS, OUTBOX], "readwrite", (transaction) => {
        transaction.objectStore(RECORDS).put({ type: 1, id: "a" });
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");

    expect(await readRows(database.name, RECORDS)).toEqual([]);
    database.close();
  });

  it("stores nothing when a request in it fails", async () => {
    const database = await openRecordsDatabase(freshName());
    await transact(database, [OUTBOX], "readwrite", (transaction, result) => {
      transaction.objectStore(OUTBOX).add({ seq: 1 });
      result(undefined);
    });

    await expect(
      transact(database, [RECORDS, OUTBOX], "readwrite", (transaction) => {
        transaction.objectStore(RECORDS).put({ type: 1, id: "a" });
        // The same key again: the database refuses it.
        transaction.objectStore(OUTBOX).add({ seq: 1 });
      }),
    ).rejects.toThrow();

    expect(await readRows(database.name, RECORDS)).toEqual([]);
    database.close();
  });
});

describe("the outbox", () => {
  it("is read oldest first", async () => {
    const name = freshName();
    const store = new EncryptedRecordStore(() => name);
    store.unlock(
      await importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i)),
      "owner-1",
    );
    const snapshot = readSnapshot("v1").expected["journal-entry"];
    for (const entry of snapshot) {
      await store.put("journal-entry", entry);
    }
    store.lock();

    const database = await openRecordsDatabase(name);
    const operations = await readOutbox(database);
    database.close();

    expect(operations.map((operation) => operation.id)).toEqual(
      snapshot.map((entry) => entry.id),
    );
    expect(operations.map((operation) => operation.seq)).toEqual([1, 2]);
  });
});
