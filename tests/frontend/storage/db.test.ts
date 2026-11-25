import { afterEach, describe, expect, it, vi } from "vitest";

import { importRootKey } from "../../../src/crypto/root-key";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  DB_VERSION,
  NewerDatabaseError,
  OUTBOX,
  RECORDS,
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
        [OUTBOX]: { keyPath: "seq", autoIncrement: true, rows: [] },
        [RECORDS]: { keyPath: ["type", "id"], autoIncrement: false, rows: [] },
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

  it("fails with the database's own error", async () => {
    failingOpen(new DOMException("synthetic", "QuotaExceededError"));

    await expect(openRecordsDatabase(freshName())).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
  });

  it("fails with a plain error when the database gives none", async () => {
    failingOpen(null);

    await expect(openRecordsDatabase(freshName())).rejects.toThrow(
      "The local database could not be opened",
    );
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
