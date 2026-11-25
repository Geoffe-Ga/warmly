/**
 * Dump an IndexedDB database to JSON and build one back from a dump.
 *
 * A dump is a picture of a database exactly as some released version of the
 * app left it. Restoring one does not use the app's own schema code, so a
 * committed dump keeps describing the past however that code changes.
 */
import { fromBase64, toBase64 } from "../../../src/crypto/encoding";

/** One object store in a dump. */
export interface StoreSnapshot {
  readonly keyPath: string | string[] | null;
  readonly autoIncrement: boolean;
  /** Rows, with any bytes written as `{ "base64": "..." }`. */
  readonly rows: readonly Record<string, unknown>[];
}

/** A whole database. */
export interface DatabaseSnapshot {
  readonly version: number;
  readonly stores: Readonly<Record<string, StoreSnapshot>>;
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });
}

function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      ArrayBuffer.isView(value)
        ? { base64: toBase64(value as Uint8Array) }
        : value,
    ]),
  );
}

function decodeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "object" && value !== null && "base64" in value
        ? fromBase64(value.base64 as string)
        : value,
    ]),
  );
}

/**
 * Open a database as it is, without upgrading it.
 *
 * @param name - The database name.
 * @returns The open database. The caller closes it.
 */
export function openRaw(name: string): Promise<IDBDatabase> {
  return settled(indexedDB.open(name));
}

/**
 * Read every row of one object store.
 *
 * @param name - The database name.
 * @param store - The object store.
 * @returns The rows, in key order.
 */
export async function readRows<T>(name: string, store: string): Promise<T[]> {
  const database = await openRaw(name);
  try {
    return (await settled(
      database.transaction(store).objectStore(store).getAll(),
    )) as T[];
  } finally {
    database.close();
  }
}

/**
 * Dump a database.
 *
 * @param name - The database name.
 * @returns Its version, stores and rows.
 */
export async function dumpDatabase(name: string): Promise<DatabaseSnapshot> {
  const database = await openRaw(name);
  try {
    const stores: Record<string, StoreSnapshot> = {};
    for (const storeName of [...database.objectStoreNames]) {
      const store = database.transaction(storeName).objectStore(storeName);
      stores[storeName] = {
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        rows: (
          (await settled(store.getAll())) as Record<string, unknown>[]
        ).map(encodeRow),
      };
    }
    return { version: database.version, stores };
  } finally {
    database.close();
  }
}

/**
 * Build a database from a dump, at the dump's version.
 *
 * @param name - The name to give the new database.
 * @param snapshot - The dump.
 */
export async function restoreDatabase(
  name: string,
  snapshot: DatabaseSnapshot,
): Promise<void> {
  const opening = indexedDB.open(name, snapshot.version);
  opening.onupgradeneeded = () => {
    for (const [storeName, store] of Object.entries(snapshot.stores)) {
      const created = opening.result.createObjectStore(storeName, {
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
      });
      for (const row of store.rows) {
        created.put(decodeRow(row));
      }
    }
  };
  (await settled(opening)).close();
}
