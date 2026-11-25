/**
 * The local database of encrypted records: its schema, its version and the
 * migrations between versions (PRD SYNC-001, §7, §13.6; ADR-0014).
 *
 * Only ciphertext and the few plain facts needed to sync it are stored here:
 * a record's ID, type, revisions and flags. No record's content, and nothing
 * derived from it such as a search index, is ever written to this database.
 */

/** The schema version this code reads and writes. */
export const DB_VERSION = 1;
/** Object store of records, keyed by `[type, id]`. */
export const RECORDS = "records";
/** Object store of queued operations, in the order they were made. */
export const OUTBOX = "outbox";

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
 * The database was written by a newer version of the app than this one. It
 * is left untouched: reading it with older code could misread or damage it.
 */
export class NewerDatabaseError extends Error {
  constructor() {
    super("The local database was written by a newer version of the app");
    this.name = "NewerDatabaseError";
  }
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
 */
export function openRecordsDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, DB_VERSION);
    opening.onupgradeneeded = (event) => {
      for (const migrate of MIGRATIONS.slice(event.oldVersion, DB_VERSION)) {
        migrate(opening.result);
      }
    };
    opening.onsuccess = () => {
      resolve(opening.result);
    };
    opening.onerror = () => {
      reject(
        opening.error?.name === "VersionError"
          ? new NewerDatabaseError()
          : (opening.error ??
              new Error("The local database could not be opened")),
      );
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
 */
export function transact<T>(
  database: IDBDatabase,
  stores: readonly string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction([...stores], mode);
    let reported: { readonly value: T } | undefined;
    transaction.oncomplete = () => {
      if (reported === undefined) {
        reject(new Error("The transaction reported no result"));
      } else {
        resolve(reported.value);
      }
    };
    const fail = (): void => {
      reject(transaction.error ?? new Error("The local database write failed"));
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
        error instanceof Error ? error : new Error("The write was abandoned"),
      );
    }
  });
}
