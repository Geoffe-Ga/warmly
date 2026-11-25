/**
 * Where the app keeps its private records (PRD SYNC-001, §7).
 *
 * Screens depend on the {@link RecordStore} interface only. The app uses
 * the encrypted store (`encrypted-record-store.ts`), which writes ciphertext
 * to IndexedDB. The in-memory store here is for tests of screens.
 */
import type { JournalEntry } from "../domain/journal/types";

/** Every kind of record, and the type stored under it. */
export interface RecordKinds {
  readonly "journal-entry": JournalEntry;
}

/** The name of a kind of record. */
export type RecordKind = keyof RecordKinds;

/**
 * This device's copy of a record was out of date: the stored record has
 * changed since it was read, for example in another tab, or cannot be read
 * by this version of the app. Nothing was written, so the newer or
 * unreadable record is never silently replaced (no last-write-wins).
 */
export class StaleRecordError extends Error {
  constructor() {
    super("The record has changed since it was read");
    this.name = "StaleRecordError";
  }
}

/**
 * A record that was changed in two places: this device's version, and the
 * version the server holds, which was kept beside it and not applied
 * (ADR-0006). Both exist until the person chooses.
 */
export interface RecordConflict<T> {
  readonly id: string;
  /** This device's version; `undefined` if it is deleted or unreadable here. */
  readonly mine: T | undefined;
  /**
   * The server's version; `undefined` if it is deleted there, or if this
   * version of the app cannot read it.
   */
  readonly theirs: T | undefined;
  /** Whether the record is deleted on the server. */
  readonly theirsDeleted: boolean;
  /**
   * The server's revision of `theirs`. Given back when the person chooses,
   * so that a choice is never applied to a version they did not see.
   */
  readonly revision: number;
}

/**
 * The server's version changed again after the person was shown it.
 * Nothing was changed: they are shown the newer version and choose again.
 */
export class ConflictChangedError extends Error {
  constructor() {
    super("The other version changed again before the choice was stored");
    this.name = "ConflictChangedError";
  }
}

/** Which version of a record in conflict to keep. */
export type Keep = "mine" | "theirs";

/** Reads and writes records by kind. */
export interface RecordStore {
  /** @returns The record, or `undefined` if there is none with that ID. */
  get<K extends RecordKind>(
    kind: K,
    id: string,
  ): Promise<RecordKinds[K] | undefined>;
  /** @returns Every record of the kind, in no particular order. */
  list<K extends RecordKind>(kind: K): Promise<RecordKinds[K][]>;
  /**
   * Add a record, or replace the one with the same ID.
   *
   * @throws StaleRecordError if the stored record has changed since this
   *   store last read it.
   */
  put<K extends RecordKind>(kind: K, record: RecordKinds[K]): Promise<void>;
  /**
   * Read one record again from where it is stored, in case it was changed
   * elsewhere, for example in another tab. Used after a write was refused
   * because this copy was out of date.
   *
   * @returns The record as it now is, or `undefined` if it is gone.
   */
  reload<K extends RecordKind>(
    kind: K,
    id: string,
  ): Promise<RecordKinds[K] | undefined>;
  /** Remove a record. Removing one that is not there does nothing. */
  delete(kind: RecordKind, id: string): Promise<void>;
  /**
   * @returns How many records of the kind are stored on this device but
   *   cannot be read by this version of the app. They are left untouched.
   */
  unreadable(kind: RecordKind): Promise<number>;
  /**
   * @returns The records of the kind that were changed in two places and
   *   are waiting for the person to choose a version.
   */
  conflicts<K extends RecordKind>(
    kind: K,
  ): Promise<RecordConflict<RecordKinds[K]>[]>;
  /**
   * Settle a record that was changed in two places.
   *
   * Keeping `mine` leaves this device's version as it is, or replaces it
   * with `merged` when one is given, and queues it to be sent on top of
   * the server's. Keeping `theirs` replaces this device's version with the
   * server's and drops what was queued. Either way the version that was
   * not kept is removed from this device, in the same step: after a crash
   * the choice is stored whole or not at all.
   *
   * @param kind - The kind of record.
   * @param id - The record's ID.
   * @param keep - Which version to keep.
   * @param seen - The `revision` of the conflict the person was shown.
   * @param merged - With `mine`: what the person wrote from the two.
   * @returns Whether anything was settled. `false` if the record is not in
   *   conflict.
   * @throws ConflictChangedError if the server's version is no longer the
   *   one the person was shown. Nothing is changed.
   * @throws RecordDeletedError if keeping that version would bring a
   *   deleted record back.
   */
  resolve<K extends RecordKind>(
    kind: K,
    id: string,
    keep: Keep,
    seen: number,
    merged?: RecordKinds[K],
  ): Promise<boolean>;
  /**
   * Be told after any record changes.
   *
   * @param listener - Called after each change.
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Drop every decrypted record from memory. Called whenever the app locks
   * or signs out, so nothing private outlives the keys.
   */
  lock(): void;
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

/** A {@link RecordStore} that keeps records in memory only. */
export class MemoryRecordStore implements RecordStore {
  // One map per kind, each typed to that kind's records.
  #records: { [K in RecordKind]: Map<string, RecordKinds[K]> } = {
    "journal-entry": new Map(),
  };
  /** The other version of each record in conflict, by ID. */
  #parked = new Map<
    string,
    { readonly theirs: JournalEntry | undefined; readonly revision: number }
  >();
  readonly #listeners = new Set<() => void>();

  #kind<K extends RecordKind>(kind: K): Map<string, RecordKinds[K]> {
    return this.#records[kind];
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  get<K extends RecordKind>(
    kind: K,
    id: string,
  ): Promise<RecordKinds[K] | undefined> {
    return Promise.resolve(this.#kind(kind).get(id));
  }

  reload<K extends RecordKind>(
    kind: K,
    id: string,
  ): Promise<RecordKinds[K] | undefined> {
    // Memory is the only place these records are kept.
    return this.get(kind, id);
  }

  list<K extends RecordKind>(kind: K): Promise<RecordKinds[K][]> {
    return Promise.resolve([...this.#kind(kind).values()]);
  }

  put<K extends RecordKind>(kind: K, record: RecordKinds[K]): Promise<void> {
    this.#kind(kind).set(record.id, record);
    this.#changed();
    return Promise.resolve();
  }

  delete(kind: RecordKind, id: string): Promise<void> {
    if (this.#kind(kind).delete(id)) {
      this.#changed();
    }
    return Promise.resolve();
  }

  unreadable(): Promise<number> {
    return Promise.resolve(0);
  }

  /**
   * Put a record in conflict, as sync does when the server's version
   * cannot replace this device's.
   *
   * @param id - The record's ID.
   * @param theirs - The server's version; `undefined` if deleted there.
   * @param revision - The server's revision of it.
   */
  park(id: string, theirs: JournalEntry | undefined, revision = 2): void {
    this.#parked.set(id, { theirs, revision });
    this.#changed();
  }

  conflicts<K extends RecordKind>(
    kind: K,
  ): Promise<RecordConflict<RecordKinds[K]>[]> {
    return Promise.resolve(
      [...this.#parked.entries()].map(([id, { theirs, revision }]) => ({
        id,
        mine: this.#kind(kind).get(id),
        theirs,
        theirsDeleted: theirs === undefined,
        revision,
      })),
    );
  }

  resolve<K extends RecordKind>(
    kind: K,
    id: string,
    keep: Keep,
    seen: number,
    merged?: RecordKinds[K],
  ): Promise<boolean> {
    const parked = this.#parked.get(id);
    if (parked === undefined) {
      return Promise.resolve(false);
    }
    if (parked.revision !== seen) {
      return Promise.reject(new ConflictChangedError());
    }
    if (keep === "mine" && parked.theirs === undefined) {
      return Promise.reject(new RecordDeletedError());
    }
    if (keep === "theirs") {
      // The real store keeps a tombstone for a deleted record; in memory a
      // deleted record is simply absent.
      if (parked.theirs === undefined) {
        this.#kind(kind).delete(id);
      } else {
        this.#kind(kind).set(id, parked.theirs);
      }
    } else if (merged !== undefined) {
      this.#kind(kind).set(id, merged);
    }
    this.#parked.delete(id);
    this.#changed();
    return Promise.resolve(true);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  lock(): void {
    this.#records = { "journal-entry": new Map() };
    this.#parked = new Map();
    this.#changed();
  }
}
