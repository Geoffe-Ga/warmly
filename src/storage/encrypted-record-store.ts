/**
 * The record store that keeps what a person writes: every record is
 * encrypted before it is written to IndexedDB, and each change is queued for
 * sync in the same transaction (PRD SYNC-001, SYNC-002, §13.6; ADR-0014).
 *
 * Decrypted records live only in this object's memory, and only between
 * `unlock` and `lock`. The database never holds a record's content or
 * anything derived from it.
 */
import { isJournalEntry } from "../domain/journal/types";
import {
  DecryptError,
  UnsupportedFormatError,
  openJson,
  sealJson,
} from "../crypto/envelope";
import type { RootKey } from "../crypto/root-key";
import {
  OUTBOX,
  RECORDS,
  openRecordsDatabase,
  transact,
  type StoredRecord,
} from "./db";
import { queueOperation } from "./outbox";
import type { RecordKind, RecordKinds, RecordStore } from "./record-store";

/** How one kind of record is stored. */
interface KindFormat<K extends RecordKind> {
  /**
   * The type number bound into the record's envelope. Never reuse or change
   * one: a record sealed as one type cannot be opened as another. 16 is
   * taken by device names (`src/devices/this-device.ts`).
   */
  readonly type: number;
  /** The version of the record's shape that this code writes and reads. */
  readonly schemaVersion: number;
  /** Checks that a decrypted value has the kind's shape. */
  readonly isValid: (value: unknown) => value is RecordKinds[K];
}

const FORMATS: { readonly [K in RecordKind]: KindFormat<K> } = {
  "journal-entry": { type: 1, schemaVersion: 1, isValid: isJournalEntry },
};

const KINDS = Object.keys(FORMATS) as RecordKind[];

/** The store was asked to write while locked. Nothing was written. */
export class StoreLockedError extends Error {
  constructor() {
    super("The record store is locked");
    this.name = "StoreLockedError";
  }
}

/**
 * A record with this ID was deleted. A deletion is kept so that it can reach
 * the person's other devices, and nothing may be written over it.
 */
export class RecordDeletedError extends Error {
  constructor() {
    super("A deleted record cannot be written again");
    this.name = "RecordDeletedError";
  }
}

type Cache = { [K in RecordKind]: Map<string, RecordKinds[K]> };
type Unreadable = { [K in RecordKind]: Set<string> };

/** What is held in memory once the database has been read. */
interface Opened {
  readonly database: IDBDatabase;
  readonly records: Cache;
  /** IDs of stored records that could not be decrypted or understood. */
  readonly unreadable: Unreadable;
}

/** One unlocked period: the key, whose records these are, and the data. */
interface Unlocked {
  readonly root: RootKey;
  readonly owner: string;
  readonly opened: Promise<Opened>;
}

/** What a write found when it looked at the stored record. */
type WriteOutcome = "written" | "absent" | "deleted";

/**
 * Decrypt one stored record.
 *
 * @returns The record, or `undefined` if it cannot be read by this code:
 *   it was written in a newer shape or format, belongs to another context,
 *   was altered, or does not have the kind's shape.
 */
async function decrypt<K extends RecordKind>(
  kind: K,
  row: StoredRecord,
  root: RootKey,
  owner: string,
): Promise<RecordKinds[K] | undefined> {
  const format: KindFormat<K> = FORMATS[kind];
  if (row.envelope === null || row.schemaVersion !== format.schemaVersion) {
    return undefined;
  }
  let value: unknown;
  try {
    value = await openJson(
      root,
      { owner, recordId: row.id, type: format.type },
      row.envelope,
    );
  } catch (error) {
    if (
      error instanceof DecryptError ||
      error instanceof UnsupportedFormatError
    ) {
      return undefined;
    }
    throw error;
  }
  // The ID inside must be the ID outside: the outside one is what the
  // envelope was bound to.
  return format.isValid(value) && value.id === row.id ? value : undefined;
}

async function loadKind<K extends RecordKind>(
  kind: K,
  rows: readonly StoredRecord[],
  session: Pick<Unlocked, "root" | "owner">,
  into: Pick<Opened, "records" | "unreadable">,
): Promise<void> {
  const mine = rows.filter(
    (row) => row.type === FORMATS[kind].type && !row.tombstone,
  );
  const decrypted = await Promise.all(
    mine.map((row) => decrypt(kind, row, session.root, session.owner)),
  );
  mine.forEach((row, index) => {
    const record = decrypted[index];
    if (record === undefined) {
      into.unreadable[kind].add(row.id);
    } else {
      into.records[kind].set(row.id, record);
    }
  });
}

async function openStore(
  name: string,
  session: Pick<Unlocked, "root" | "owner">,
): Promise<Opened> {
  const database = await openRecordsDatabase(name);
  // If another tab running newer code needs to upgrade the database, let it:
  // this tab's writes then fail, which is safer than blocking the upgrade.
  database.onversionchange = () => {
    database.close();
  };
  const opened: Opened = {
    database,
    records: { "journal-entry": new Map() },
    unreadable: { "journal-entry": new Set() },
  };
  try {
    const rows = await transact<StoredRecord[]>(
      database,
      [RECORDS],
      "readonly",
      (transaction, result) => {
        const reading = transaction.objectStore(RECORDS).getAll();
        reading.onsuccess = () => {
          result(reading.result as StoredRecord[]);
        };
      },
    );
    await Promise.all(
      KINDS.map((kind) => loadKind(kind, rows, session, opened)),
    );
  } catch (error) {
    database.close();
    throw error;
  }
  return opened;
}

/**
 * Write a record, or its deletion, and queue the change for sync. Both
 * happen in one transaction: either both are stored or neither is.
 *
 * @param change - The record's type and ID, and its new envelope; a `null`
 *   envelope deletes the record.
 * @returns What was found: `"absent"` and `"deleted"` mean nothing was
 *   written.
 */
function writeChange(
  database: IDBDatabase,
  change: Pick<StoredRecord, "type" | "id" | "envelope" | "schemaVersion">,
): Promise<WriteOutcome> {
  return transact<WriteOutcome>(
    database,
    [RECORDS, OUTBOX],
    "readwrite",
    (transaction, result) => {
      const records = transaction.objectStore(RECORDS);
      const reading = records.get([change.type, change.id]);
      reading.onsuccess = () => {
        const existing = reading.result as StoredRecord | undefined;
        const deleting = change.envelope === null;
        if (existing?.tombstone === true) {
          result(deleting ? "absent" : "deleted");
          return;
        }
        if (existing === undefined && deleting) {
          result("absent");
          return;
        }
        const row: StoredRecord = {
          type: change.type,
          id: change.id,
          envelope: change.envelope,
          schemaVersion: deleting
            ? (existing?.schemaVersion ?? change.schemaVersion)
            : change.schemaVersion,
          localRevision: (existing?.localRevision ?? 0) + 1,
          baseRevision: existing?.baseRevision ?? 0,
          tombstone: deleting,
          dirty: true,
        };
        try {
          records.put(row);
          queueOperation(transaction, {
            opId: crypto.randomUUID(),
            type: row.type,
            id: row.id,
            localRevision: row.localRevision,
            baseRevision: row.baseRevision,
            schemaVersion: row.schemaVersion,
            tombstone: row.tombstone,
          });
          result("written");
        } catch {
          transaction.abort();
        }
      };
    },
  );
}

/** A {@link RecordStore} that keeps encrypted records in IndexedDB. */
export class EncryptedRecordStore implements RecordStore {
  readonly #databaseName: (owner: string) => string;
  readonly #listeners = new Set<() => void>();
  #session: Unlocked | undefined;

  /**
   * @param databaseName - Gives the database name for an account.
   */
  constructor(databaseName: (owner: string) => string) {
    this.#databaseName = databaseName;
  }

  /**
   * Start an unlocked period: open the account's database and decrypt its
   * records into memory. Returns at once; reads wait for the loading.
   *
   * @param root - The account root key.
   * @param owner - The account the key belongs to.
   */
  unlock(root: RootKey, owner: string): void {
    this.#end();
    const opened = openStore(this.#databaseName(owner), { root, owner });
    // A failure is reported by whichever read or write waits on it. This
    // handler only stops it being reported as unhandled when nothing waits.
    opened.catch(() => undefined);
    this.#session = { root, owner, opened };
    this.#changed();
  }

  lock(): void {
    this.#end();
    this.#changed();
  }

  /** Forget the key and every decrypted record, and close the database. */
  #end(): void {
    const session = this.#session;
    this.#session = undefined;
    void session?.opened.then(
      (opened) => {
        for (const kind of KINDS) {
          opened.records[kind].clear();
          opened.unreadable[kind].clear();
        }
        // Closing waits for any write that is already under way.
        opened.database.close();
      },
      () => undefined,
    );
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  /** The data of the current unlocked period, or nothing once locked. */
  async #read(): Promise<Opened | undefined> {
    const session = this.#session;
    if (session === undefined) {
      return undefined;
    }
    const opened = await session.opened;
    return this.#session === session ? opened : undefined;
  }

  async get<K extends RecordKind>(
    kind: K,
    id: string,
  ): Promise<RecordKinds[K] | undefined> {
    return (await this.#read())?.records[kind].get(id);
  }

  async list<K extends RecordKind>(kind: K): Promise<RecordKinds[K][]> {
    return [...((await this.#read())?.records[kind].values() ?? [])];
  }

  async unreadable(kind: RecordKind): Promise<number> {
    return (await this.#read())?.unreadable[kind].size ?? 0;
  }

  /**
   * Run one write for the current unlocked period.
   *
   * @param prepare - Builds the change, using the key. Runs before the
   *   database is touched, because a transaction cannot wait for it.
   * @param apply - Updates memory once the change is stored.
   */
  async #write(
    prepare: (session: Unlocked) => Promise<Parameters<typeof writeChange>[1]>,
    apply: (opened: Opened) => void,
  ): Promise<void> {
    const session = this.#session;
    if (session === undefined) {
      throw new StoreLockedError();
    }
    const change = await prepare(session);
    const opened = await session.opened;
    if (this.#session !== session) {
      // Locked while the record was being encrypted.
      throw new StoreLockedError();
    }
    const outcome = await writeChange(opened.database, change);
    if (outcome === "deleted") {
      throw new RecordDeletedError();
    }
    if (outcome === "written" && this.#session === session) {
      apply(opened);
      this.#changed();
    }
  }

  put<K extends RecordKind>(kind: K, record: RecordKinds[K]): Promise<void> {
    const { type, schemaVersion } = FORMATS[kind];
    return this.#write(
      async ({ root, owner }) => ({
        type,
        id: record.id,
        schemaVersion,
        envelope: await sealJson(
          root,
          { owner, recordId: record.id, type },
          record,
        ),
      }),
      (opened) => {
        opened.records[kind].set(record.id, record);
        opened.unreadable[kind].delete(record.id);
      },
    );
  }

  delete(kind: RecordKind, id: string): Promise<void> {
    const { type, schemaVersion } = FORMATS[kind];
    return this.#write(
      () => Promise.resolve({ type, id, schemaVersion, envelope: null }),
      (opened) => {
        opened.records[kind].delete(id);
        opened.unreadable[kind].delete(id);
      },
    );
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
