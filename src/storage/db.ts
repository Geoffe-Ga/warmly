/**
 * The local database of encrypted records: its schema, its version and the
 * migrations between versions (PRD SYNC-001, §7, §13.6; ADR-0014).
 *
 * Only ciphertext and the few plain facts needed to sync it are stored here:
 * a record's ID, type, revisions and flags, and this device's place in the
 * change feed. No record's content, and nothing
 * derived from it such as a search index, is ever written to this database.
 */

import {
  StorageBlockedError,
  StorageUnavailableError,
  openFailure,
  useFailure,
} from "./errors";

export { NewerDatabaseError } from "./errors";

/** The schema version this code reads and writes. */
export const DB_VERSION = 2;
/** Object store of records, keyed by `[type, id]`. */
export const RECORDS = "records";
/** Object store of queued operations, in the order they were made. */
export const OUTBOX = "outbox";
/** Object store of small facts about sync, keyed by name. */
export const META = "meta";
/**
 * Object store of server versions that could not replace a local record,
 * keyed by `[type, id]`. Each is kept, still encrypted, beside the local
 * version until the person decides between them.
 */
export const PARKED = "parked";

/** The `meta` row that holds this device's place in the change feed. */
export const CURSOR_KEY = "cursor";

/** One row of the `meta` store. */
export interface MetaRow {
  readonly key: string;
  readonly value: string;
}

/** The server's version of a record, kept beside a local one it clashes with. */
export interface ParkedRecord {
  readonly type: number;
  readonly id: string;
  /** The server's encrypted record, or `null` if it is deleted there. */
  readonly envelope: Uint8Array<ArrayBuffer> | null;
  readonly schemaVersion: number;
  /** The record's revision on the server. */
  readonly revision: number;
  readonly tombstone: boolean;
}

/** One record as stored. Everything but `envelope` is plain metadata. */
export interface StoredRecord {
  /** The record's type number, as bound into its envelope. */
  readonly type: number;
  /** An opaque random UUID. */
  readonly id: string;
  /** The encrypted record, or `null` once it has been deleted. */
  readonly envelope: Uint8Array<ArrayBuffer> | null;
  /** The version of the record's own shape inside the envelope. */
  readonly schemaVersion: number;
  /** Counts this device's changes to the record, from 1. */
  readonly localRevision: number;
  /** The server revision this device last saw; 0 before any sync. */
  readonly baseRevision: number;
  /** Whether the record has been deleted. A tombstone is kept for sync. */
  readonly tombstone: boolean;
  /** Whether there is a change the server has not acknowledged. */
  readonly dirty: boolean;
}

/**
 * One step per schema version. Step `n` takes a database from version `n`
 * to `n + 1`. Steps are forward-only and are never edited once released: a
 * new change is a new step. Each runs inside the upgrade transaction, so a
 * step that fails leaves the database exactly as it was.
 */
const MIGRATIONS: readonly ((database: IDBDatabase) => void)[] = [
  // 0 -> 1: the first schema.
  (database) => {
    database.createObjectStore(RECORDS, { keyPath: ["type", "id"] });
    database.createObjectStore(OUTBOX, { keyPath: "seq", autoIncrement: true });
  },
  // 1 -> 2: where this device is in the change feed, and server versions
  // waiting for the person to choose (ADR-0006).
  (database) => {
    database.createObjectStore(META, { keyPath: "key" });
    database.createObjectStore(PARKED, { keyPath: ["type", "id"] });
  },
];

/**
 * The database name for an account. Each account has its own database, so
 * two accounts used in one browser never share a key space.
 *
 * @param owner - The account's ID.
 * @param prefix - A build may add a prefix, for example one per tab in tests.
 * @returns The database name.
 */
export function recordsDatabaseName(owner: string, prefix = "warmly"): string {
  return `${prefix}-records-${owner}`;
}

/**
 * Open an account's database, creating or upgrading it as needed.
 *
 * @param name - The database name.
 * @returns The open database. The caller closes it.
 * @throws NewerDatabaseError if a newer app version has upgraded it.
 * @throws StorageUnavailableError if the browser has no usable database.
 * @throws StorageBlockedError if another tab stops it being upgraded.
 * @throws StorageFullError if there is no room to create it.
 */
export function openRecordsDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let opening: IDBOpenDBRequest;
    try {
      // Some browsers have no IndexedDB in a private window, and some throw
      // as soon as it is touched.
      opening = indexedDB.open(name, DB_VERSION);
    } catch {
      reject(new StorageUnavailableError());
      return;
    }
    let blocked = false;
    opening.onupgradeneeded = (event) => {
      for (const migrate of MIGRATIONS.slice(event.oldVersion, DB_VERSION)) {
        migrate(opening.result);
      }
    };
    // Another tab has the database open at an older version and has not let
    // go. Waiting could take for ever, so this open is given up: the person
    // is told to close the other tabs.
    opening.onblocked = () => {
      blocked = true;
      reject(new StorageBlockedError());
    };
    opening.onsuccess = () => {
      if (blocked) {
        // The other tab let go after this open was given up.
        opening.result.close();
      } else {
        resolve(opening.result);
      }
    };
    opening.onerror = () => {
      reject(openFailure(opening.error));
    };
  });
}

/**
 * Run one transaction and settle when it has committed or aborted.
 *
 * @param database - The open database.
 * @param stores - The object stores the work touches.
 * @param mode - Read-only or read-write.
 * @param work - Issues requests on the transaction and calls `result` with
 *   the value to resolve with. Throwing aborts the transaction.
 * @returns What `work` reported, once everything is committed.
 * @throws Error if the transaction committed without `work` reporting a
 *   value. Work that has nothing to report passes `undefined`.
 * @throws StorageFullError if the device has no room for the write.
 * @throws StorageUnavailableError if the database can no longer be used.
 */
export function transact<T>(
  database: IDBDatabase,
  stores: readonly string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction([...stores], mode);
    } catch (error) {
      // The database was closed under this tab, for example because a newer
      // version of the app took it over in another one.
      reject(useFailure(error) ?? new StorageUnavailableError());
      return;
    }
    let reported: { readonly value: T } | undefined;
    transaction.oncomplete = () => {
      if (reported === undefined) {
        reject(new Error("The transaction reported no result"));
      } else {
        resolve(reported.value);
      }
    };
    const fail = (): void => {
      reject(
        useFailure(transaction.error) ??
          transaction.error ??
          new Error("The local database write failed"),
      );
    };
    transaction.onabort = fail;
    transaction.onerror = fail;
    try {
      work(transaction, (value) => {
        reported = { value };
      });
    } catch (error) {
      transaction.abort();
      reject(
        useFailure(error) ??
          (error instanceof Error
            ? error
            : new Error("The write was abandoned")),
      );
    }
  });
}
