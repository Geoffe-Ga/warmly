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
import { NewerDatabaseError } from "./errors";
import {
  CURSOR_KEY,
  META,
  OUTBOX,
  PARKED,
  RECORDS,
  openRecordsDatabase,
  transact,
  type MetaRow,
  type ParkedRecord,
  type StoredRecord,
} from "./db";
import type {
  Acknowledged,
  PendingChange,
  RemoteOutcome,
  SyncSource,
} from "../sync/source";
import type { RemoteChange } from "../sync/protocol";
import { queueOperation, type OutboxOperation } from "./outbox";
import {
  ConflictChangedError,
  RecordDeletedError,
  StaleRecordError,
  type Keep,
  type RecordConflict,
  type RecordKind,
  type RecordKinds,
  type RecordStore,
} from "./record-store";

export { RecordDeletedError, StaleRecordError } from "./record-store";

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

/** A decrypted record and the local revision it was read at. */
interface Held<T> {
  readonly record: T;
  readonly revision: number;
}

type Cache = { [K in RecordKind]: Map<string, Held<RecordKinds[K]>> };
type Unreadable = { [K in RecordKind]: Set<string> };

/** What is held in memory once the database has been read. */
interface Opened {
  readonly database: IDBDatabase;
  readonly records: Cache;
  /** IDs of stored records that could not be decrypted or understood. */
  readonly unreadable: Unreadable;
  /**
   * Set once a newer version of the app, in another tab, has upgraded the
   * database. This tab's connection is closed from then on.
   */
  superseded: boolean;
}

/** One unlocked period: the key, whose records these are, and the data. */
interface Unlocked {
  readonly root: RootKey;
  readonly owner: string;
  readonly opened: Promise<Opened>;
}

/** What a write found when it looked at the stored record. */
type WriteOutcome =
  | { readonly kind: "written"; readonly revision: number }
  | { readonly kind: "absent" | "deleted" | "stale" };

/** A change to store: the row's identity, its new envelope, and a check. */
interface Change extends Pick<
  StoredRecord,
  "type" | "id" | "envelope" | "schemaVersion"
> {
  /**
   * The local revision the caller's copy was read at, or 0 if it holds no
   * copy. The write is refused unless the stored row is still at it. Left
   * out for a deletion, which applies to whatever is stored.
   */
  readonly expectedRevision?: number;
}

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
      into.records[kind].set(row.id, { record, revision: row.localRevision });
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
  const opened: Opened = {
    database,
    records: { "journal-entry": new Map() },
    unreadable: { "journal-entry": new Set() },
    superseded: false,
  };
  database.onversionchange = (event) => {
    database.close();
    // A new version number means newer code is upgrading the database. No
    // number means it is being deleted, which is not the same thing.
    opened.superseded = event.newVersion !== null;
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
 * @returns What happened. Only `"written"` means anything was stored.
 */
function writeChange(
  database: IDBDatabase,
  change: Change,
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
          result({ kind: deleting ? "absent" : "deleted" });
          return;
        }
        if (existing === undefined && deleting) {
          result({ kind: "absent" });
          return;
        }
        if (
          change.expectedRevision !== undefined &&
          change.expectedRevision !== (existing?.localRevision ?? 0)
        ) {
          result({ kind: "stale" });
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
          result({ kind: "written", revision: row.localRevision });
        } catch {
          // Aborting undoes the record write. The transaction then reports
          // the failure through its abort event, which rejects the write.
          transaction.abort();
        }
      };
    },
  );
}

/** Read every row of the records and outbox stores in one transaction. */
function readAll(
  database: IDBDatabase,
): Promise<{ rows: StoredRecord[]; operations: OutboxOperation[] }> {
  return transact(
    database,
    [RECORDS, OUTBOX],
    "readonly",
    (transaction, result) => {
      const rows = transaction.objectStore(RECORDS).getAll();
      const operations = transaction.objectStore(OUTBOX).getAll();
      operations.onsuccess = () => {
        result({
          rows: rows.result as StoredRecord[],
          operations: operations.result as OutboxOperation[],
        });
      };
    },
  );
}

/** Read every server version kept beside a local record. */
function readParked(database: IDBDatabase): Promise<ParkedRecord[]> {
  return transact<ParkedRecord[]>(
    database,
    [PARKED],
    "readonly",
    (transaction, result) => {
      const reading = transaction.objectStore(PARKED).getAll();
      reading.onsuccess = () => {
        result(reading.result as ParkedRecord[]);
      };
    },
  );
}

/** What settling a record in conflict did. */
type Settled =
  /**
   * Nothing was done: the record was not in conflict (`none`), keeping that
   * version is not allowed (`deleted`), or the server's version is not the
   * one the person was shown (`changed`).
   */
  | { readonly kind: "none" | "deleted" | "changed" }
  /** Settled. `row` is the local row if it was written. */
  | { readonly kind: "settled"; readonly row?: StoredRecord };

/** A choice between two versions of one record. */
interface Choice {
  readonly type: number;
  readonly id: string;
  readonly keep: Keep;
  /** The parked revision the person was shown. */
  readonly seen: number;
  /** With `mine`: what replaces this device's version. */
  readonly replacement:
    Pick<StoredRecord, "envelope" | "schemaVersion"> | undefined;
}

/**
 * Keep one version of a record in conflict and remove the other, in one
 * transaction (ADR-0006).
 */
function settle(database: IDBDatabase, choice: Choice): Promise<Settled> {
  const { type, id, keep, replacement } = choice;
  return transact<Settled>(
    database,
    [RECORDS, OUTBOX, PARKED],
    "readwrite",
    (transaction, result) => {
      const records = transaction.objectStore(RECORDS);
      const outbox = transaction.objectStore(OUTBOX);
      const parked = transaction.objectStore(PARKED);
      const key = [type, id];
      const kept = parked.get(key);
      const reading = records.get(key);
      const queued = outbox.getAll();
      queued.onsuccess = () => {
        const theirs = kept.result as ParkedRecord | undefined;
        const mine = reading.result as StoredRecord | undefined;
        if (theirs === undefined) {
          result({ kind: "none" });
          return;
        }
        if (theirs.revision !== choice.seen) {
          // A newer version arrived after the person was shown the other
          // one. It is not removed unseen.
          result({ kind: "changed" });
          return;
        }
        if (revives(choice, mine, theirs)) {
          result({ kind: "deleted" });
          return;
        }
        parked.delete(key);
        if (keep === "mine") {
          result(keepLocal(transaction, mine, theirs, replacement));
          return;
        }
        const row: StoredRecord = {
          type,
          id,
          envelope: theirs.envelope,
          schemaVersion: theirs.schemaVersion,
          localRevision: (mine?.localRevision ?? 0) + 1,
          baseRevision: theirs.revision,
          tombstone: theirs.tombstone,
          dirty: false,
        };
        records.put(row);
        // This device's version is given up, so nothing is left to send.
        for (const operation of queued.result as OutboxOperation[]) {
          if (operation.type === type && operation.id === id) {
            outbox.delete(operation.seq);
          }
        }
        result({ kind: "settled", row });
      };
    },
  );
}

/**
 * Whether a choice would bring a deleted record back (ADR-0006).
 *
 * A record the server holds as deleted never comes back under its ID, and
 * new text is never written over a deletion made here. The one thing that
 * may be undone is a deletion made on this device that the server never
 * accepted: it is this device's own unsent change.
 */
function revives(
  choice: Choice,
  mine: StoredRecord | undefined,
  theirs: ParkedRecord,
): boolean {
  const deletedHere = mine?.tombstone === true;
  if (choice.keep === "mine") {
    return deletedHere ? choice.replacement !== undefined : theirs.tombstone;
  }
  return deletedHere && mine.dirty === false && !theirs.tombstone;
}

/**
 * Keep this device's version, or what the person wrote in its place, on
 * top of the server's: still unsent, so the next sync sends it and the
 * server accepts it.
 */
function keepLocal(
  transaction: IDBTransaction,
  mine: StoredRecord | undefined,
  theirs: ParkedRecord,
  replacement: Choice["replacement"],
): Settled {
  if (mine === undefined) {
    return { kind: "settled" };
  }
  const row: StoredRecord = {
    ...mine,
    ...replacement,
    localRevision: mine.localRevision + (replacement === undefined ? 0 : 1),
    baseRevision: theirs.revision,
    dirty: true,
  };
  transaction.objectStore(RECORDS).put(row);
  if (replacement === undefined) {
    return { kind: "settled" };
  }
  // New text is a new change: queued like any other.
  queueOperation(transaction, {
    opId: crypto.randomUUID(),
    type: row.type,
    id: row.id,
    localRevision: row.localRevision,
    baseRevision: row.baseRevision,
    schemaVersion: row.schemaVersion,
    tombstone: false,
  });
  return { kind: "settled", row };
}

/** What applying one change from the server did. */
interface Applied {
  readonly outcome: RemoteOutcome;
  /** The row that was stored, when the change was applied. */
  readonly row?: StoredRecord;
}

const keyOf = (row: Pick<StoredRecord, "type" | "id">): string =>
  `${String(row.type)}:${row.id}`;

/**
 * Whether a change from the server may replace the local row, and if not,
 * why not (ADR-0006).
 */
function meet(
  row: StoredRecord | undefined,
  change: RemoteChange,
): RemoteOutcome {
  if (row === undefined) {
    return "applied";
  }
  if (row.dirty) {
    // At the base, the server is still where this device's unsent change
    // started. Below it, the change is one this device has already seen,
    // met again because the feed was read from the start.
    return change.revision <= row.baseRevision ? "unchanged" : "conflict";
  }
  if (change.revision <= row.baseRevision) {
    return "unchanged";
  }
  // A record deleted here is never brought back, whatever a server says.
  return row.tombstone && !change.tombstone ? "conflict" : "applied";
}

/** A {@link RecordStore} that keeps encrypted records in IndexedDB. */
export class EncryptedRecordStore implements RecordStore, SyncSource {
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
    return (await this.#read())?.records[kind].get(id)?.record;
  }

  async list<K extends RecordKind>(kind: K): Promise<RecordKinds[K][]> {
    const held = (await this.#read())?.records[kind].values() ?? [];
    return [...held].map((each) => each.record);
  }

  async reload<K extends RecordKind>(
    kind: K,
    id: string,
  ): Promise<RecordKinds[K] | undefined> {
    const session = this.#session;
    const opened = await this.#read();
    if (session === undefined || opened === undefined) {
      return undefined;
    }
    if (opened.superseded) {
      throw new NewerDatabaseError();
    }
    const row = await transact<StoredRecord | undefined>(
      opened.database,
      [RECORDS],
      "readonly",
      (transaction, result) => {
        const reading = transaction
          .objectStore(RECORDS)
          .get([FORMATS[kind].type, id]);
        reading.onsuccess = () => {
          result(reading.result as StoredRecord | undefined);
        };
      },
    );
    const record =
      row === undefined || row.tombstone
        ? undefined
        : await decrypt(kind, row, session.root, session.owner);
    if (this.#session !== session) {
      return undefined;
    }
    opened.records[kind].delete(id);
    opened.unreadable[kind].delete(id);
    if (row !== undefined && !row.tombstone) {
      if (record === undefined) {
        opened.unreadable[kind].add(id);
      } else {
        opened.records[kind].set(id, { record, revision: row.localRevision });
      }
    }
    this.#changed();
    return record;
  }

  async unreadable(kind: RecordKind): Promise<number> {
    return (await this.#read())?.unreadable[kind].size ?? 0;
  }

  async conflicts<K extends RecordKind>(
    kind: K,
  ): Promise<RecordConflict<RecordKinds[K]>[]> {
    const session = this.#session;
    const opened = await this.#read();
    if (session === undefined || opened === undefined || opened.superseded) {
      return [];
    }
    const { type } = FORMATS[kind];
    const parked = (await readParked(opened.database)).filter(
      (kept) => kept.type === type,
    );
    return Promise.all(
      parked.map(async (kept) => ({
        id: kept.id,
        mine: opened.records[kind].get(kept.id)?.record,
        theirs: await decrypt(
          kind,
          // Only the envelope and the fields that say how to read it matter.
          {
            ...kept,
            localRevision: 0,
            baseRevision: kept.revision,
            dirty: false,
          },
          session.root,
          session.owner,
        ),
        theirsDeleted: kept.tombstone,
        revision: kept.revision,
      })),
    );
  }

  async resolve<K extends RecordKind>(
    kind: K,
    id: string,
    keep: Keep,
    seen: number,
    merged?: RecordKinds[K],
  ): Promise<boolean> {
    const session = this.#session;
    const opened = await this.#read();
    if (session === undefined || opened === undefined) {
      throw new StoreLockedError();
    }
    if (opened.superseded) {
      throw new NewerDatabaseError();
    }
    const { type, schemaVersion } = FORMATS[kind];
    // Encrypted before the transaction, which cannot wait for it.
    const replacement =
      merged === undefined
        ? undefined
        : {
            schemaVersion,
            envelope: await sealJson(
              session.root,
              { owner: session.owner, recordId: id, type },
              merged,
            ),
          };
    if (this.#session !== session) {
      throw new StoreLockedError();
    }
    const settled = await settle(opened.database, {
      type,
      id,
      keep,
      seen,
      replacement,
    });
    if (settled.kind === "deleted") {
      throw new RecordDeletedError();
    }
    if (settled.kind === "changed") {
      throw new ConflictChangedError();
    }
    if (settled.kind !== "settled") {
      return false;
    }
    if (this.#session === session) {
      if (settled.row !== undefined) {
        await this.#remember(opened, session, settled.row);
      }
      this.#changed();
    }
    return true;
  }

  /**
   * Run one write for the current unlocked period.
   *
   * @param prepare - Builds the change, using the key. Runs before the
   *   database is touched, because a transaction cannot wait for it.
   * @param apply - Updates memory once the change is stored.
   */
  async #write(
    prepare: (session: Unlocked, opened: Opened) => Promise<Change>,
    apply: (opened: Opened, revision: number) => void,
  ): Promise<void> {
    const session = this.#session;
    if (session === undefined) {
      throw new StoreLockedError();
    }
    const opened = await session.opened;
    if (opened.superseded) {
      throw new NewerDatabaseError();
    }
    const change = await prepare(session, opened);
    if (this.#session !== session) {
      // Locked while the record was being encrypted.
      throw new StoreLockedError();
    }
    const outcome = await writeChange(opened.database, change);
    if (outcome.kind === "deleted") {
      throw new RecordDeletedError();
    }
    if (outcome.kind === "stale") {
      throw new StaleRecordError();
    }
    if (outcome.kind === "written" && this.#session === session) {
      apply(opened, outcome.revision);
      this.#changed();
    }
  }

  put<K extends RecordKind>(kind: K, record: RecordKinds[K]): Promise<void> {
    const { type, schemaVersion } = FORMATS[kind];
    return this.#write(
      async ({ root, owner }, opened) => ({
        type,
        id: record.id,
        schemaVersion,
        // Read before encrypting, which takes a moment: the check must be
        // against the copy this write was based on.
        expectedRevision: opened.records[kind].get(record.id)?.revision ?? 0,
        envelope: await sealJson(
          root,
          { owner, recordId: record.id, type },
          record,
        ),
      }),
      (opened, revision) => {
        // A row that could not be read is never written over, so there is
        // nothing to remove from `unreadable` here.
        opened.records[kind].set(record.id, { record, revision });
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

  async pending(): Promise<PendingChange[]> {
    const opened = await this.#read();
    if (opened === undefined || opened.superseded) {
      return [];
    }
    const { rows, operations } = await readAll(opened.database);
    // A record with a server version kept beside it is not sent: the server
    // has moved on from what it was based on and would refuse it again.
    // It is sent once the person has chosen.
    const aside = new Set((await readParked(opened.database)).map(keyOf));
    const byKey = new Map(
      rows
        .filter((row) => !aside.has(keyOf(row)))
        .map((row) => [keyOf(row), row]),
    );
    // Only the record as it is now is worth sending, however many times it
    // changed. It is sent under the ID of its oldest queued change: if an
    // earlier attempt reached the server and the answer was lost, the
    // server recognises the ID instead of seeing a second, clashing change.
    const oldest = new Map<string, OutboxOperation>();
    const newest = new Map<string, OutboxOperation>();
    for (const operation of operations) {
      const key = keyOf(operation);
      if (!oldest.has(key)) {
        oldest.set(key, operation);
      }
      newest.set(key, operation);
    }
    return [...oldest.entries()]
      .sort(([, left], [, right]) => left.seq - right.seq)
      .flatMap(([key, first]) => {
        const row = byKey.get(key);
        return row === undefined
          ? []
          : [
              {
                operation: {
                  opId: first.opId,
                  recordId: row.id,
                  type: row.type,
                  baseRevision: row.baseRevision,
                  schemaVersion: row.schemaVersion,
                  tombstone: row.tombstone,
                  payload: row.envelope,
                },
                first: first.seq,
                upTo: newest.get(key)?.seq ?? first.seq,
                localRevision: row.localRevision,
              },
            ];
      });
  }

  async acknowledge(
    change: PendingChange,
    serverRevision: number,
    acknowledged: Acknowledged,
  ): Promise<void> {
    const opened = await this.#read();
    if (opened === undefined) {
      throw new StoreLockedError();
    }
    const { type, recordId } = change.operation;
    // "earlier" means the server had already applied the oldest queued
    // change, with whatever the record held when that was first sent. Only
    // that change is settled; anything made since still has to be sent.
    const through = acknowledged === "current" ? change.upTo : change.first;
    await transact<undefined>(
      opened.database,
      [RECORDS, OUTBOX, PARKED],
      "readwrite",
      (transaction, result) => {
        const records = transaction.objectStore(RECORDS);
        const outbox = transaction.objectStore(OUTBOX);
        const parked = transaction.objectStore(PARKED);
        const reading = records.get([type, recordId]);
        reading.onsuccess = () => {
          const row = reading.result as StoredRecord | undefined;
          if (row !== undefined) {
            records.put({
              ...row,
              baseRevision: serverRevision,
              // Changed again since it was sent, or only an earlier change
              // was settled: still waiting, on the new base.
              dirty:
                row.localRevision !== change.localRevision ||
                through < change.upTo,
            } satisfies StoredRecord);
          }
        };
        // The server now holds this device's version on top of the one
        // that was kept aside, so there is nothing left to choose between.
        // A kept version at a higher revision is a newer clash, and stays.
        const kept = parked.get([type, recordId]);
        kept.onsuccess = () => {
          const aside = kept.result as ParkedRecord | undefined;
          if (aside !== undefined && aside.revision <= serverRevision) {
            parked.delete([type, recordId]);
          }
        };
        const queued = outbox.getAll();
        queued.onsuccess = () => {
          for (const operation of queued.result as OutboxOperation[]) {
            if (
              operation.type === type &&
              operation.id === recordId &&
              operation.seq <= through
            ) {
              outbox.delete(operation.seq);
            }
          }
          result(undefined);
        };
      },
    );
    this.#changed();
  }

  async applyPage(
    changes: readonly RemoteChange[],
    nextCursor: string,
  ): Promise<RemoteOutcome[]> {
    const session = this.#session;
    const opened = await this.#read();
    if (session === undefined || opened === undefined) {
      throw new StoreLockedError();
    }
    if (opened.superseded) {
      throw new NewerDatabaseError();
    }
    const written = await transact<Applied[]>(
      opened.database,
      [RECORDS, PARKED, META],
      "readwrite",
      (transaction, result) => {
        const records = transaction.objectStore(RECORDS);
        const parked = transaction.objectStore(PARKED);
        const applied: Applied[] = [];
        for (const [index, change] of changes.entries()) {
          const key = [change.type, change.recordId];
          const reading = records.get(key);
          reading.onsuccess = () => {
            const existing = reading.result as StoredRecord | undefined;
            const outcome = meet(existing, change);
            applied[index] = { outcome };
            // A record deleted here and already settled with the server
            // is the other kind of "conflict": a live version of it is
            // ignored on purpose and not kept, because a deleted record
            // never comes back (ADR-0006).
            if (outcome === "conflict" && existing?.dirty === true) {
              // Not applied over the local change. Kept, still encrypted,
              // for the person to choose.
              parked.put({
                type: change.type,
                id: change.recordId,
                envelope: change.payload,
                schemaVersion: change.schemaVersion,
                revision: change.revision,
                tombstone: change.tombstone,
              } satisfies ParkedRecord);
            }
            if (outcome !== "applied") {
              return;
            }
            const row: StoredRecord = {
              type: change.type,
              id: change.recordId,
              envelope: change.payload,
              schemaVersion: change.schemaVersion,
              // A change from elsewhere is a change to this device's copy
              // too, so another tab's out-of-date copy is noticed.
              localRevision: (existing?.localRevision ?? 0) + 1,
              baseRevision: change.revision,
              tombstone: change.tombstone,
              dirty: false,
            };
            records.put(row);
            parked.delete(key);
            applied[index] = { outcome, row };
          };
        }
        // The cursor moves in the same transaction as the records it
        // covers: after a crash the device has both or neither.
        const moving = transaction
          .objectStore(META)
          .put({ key: CURSOR_KEY, value: nextCursor } satisfies MetaRow);
        moving.onsuccess = () => {
          result(applied);
        };
      },
    );
    if (this.#session === session) {
      for (const { row } of written) {
        if (row !== undefined) {
          await this.#remember(opened, session, row);
        }
      }
      // A version kept aside changes what needs the person, so listeners
      // are told about that too.
      if (
        written.some(
          ({ row, outcome }) => row !== undefined || outcome === "conflict",
        )
      ) {
        this.#changed();
      }
    }
    return written.map(({ outcome }) => outcome);
  }

  async cursor(): Promise<string> {
    const opened = await this.#read();
    if (opened === undefined || opened.superseded) {
      return "0";
    }
    return transact<string>(
      opened.database,
      [META],
      "readonly",
      (transaction, result) => {
        const reading = transaction.objectStore(META).get(CURSOR_KEY);
        reading.onsuccess = () => {
          result((reading.result as MetaRow | undefined)?.value ?? "0");
        };
      },
    );
  }

  async forgetCursor(): Promise<void> {
    const opened = await this.#read();
    if (opened === undefined) {
      throw new StoreLockedError();
    }
    await transact<undefined>(
      opened.database,
      [META],
      "readwrite",
      (transaction, result) => {
        transaction.objectStore(META).delete(CURSOR_KEY).onsuccess = () => {
          result(undefined);
        };
      },
    );
  }

  async parkedCount(): Promise<number> {
    const opened = await this.#read();
    if (opened === undefined || opened.superseded) {
      return 0;
    }
    return transact<number>(
      opened.database,
      [PARKED],
      "readonly",
      (transaction, result) => {
        const counting = transaction.objectStore(PARKED).count();
        counting.onsuccess = () => {
          result(counting.result);
        };
      },
    );
  }

  /** Put a row that was just stored into memory, decrypted. */
  async #remember(
    opened: Opened,
    session: Unlocked,
    row: StoredRecord,
  ): Promise<void> {
    const kind = KINDS.find((each) => FORMATS[each].type === row.type);
    if (kind === undefined) {
      // A kind this version does not know: kept on disk, not shown.
      return;
    }
    opened.records[kind].delete(row.id);
    opened.unreadable[kind].delete(row.id);
    if (row.tombstone) {
      return;
    }
    await loadKind(kind, [row], session, opened);
  }

  async pendingCount(): Promise<number> {
    const opened = await this.#read();
    if (opened === undefined || opened.superseded) {
      return 0;
    }
    const { rows } = await readAll(opened.database);
    return rows.filter((row) => row.dirty).length;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
