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

/** Reads and writes records by kind. */
export interface RecordStore {
  /** @returns The record, or `undefined` if there is none with that ID. */
  get<K extends RecordKind>(
    kind: K,
    id: string,
  ): Promise<RecordKinds[K] | undefined>;
  /** @returns Every record of the kind, in no particular order. */
  list<K extends RecordKind>(kind: K): Promise<RecordKinds[K][]>;
  /** Add a record, or replace the one with the same ID. */
  put<K extends RecordKind>(kind: K, record: RecordKinds[K]): Promise<void>;
  /** Remove a record. Removing one that is not there does nothing. */
  delete(kind: RecordKind, id: string): Promise<void>;
  /**
   * @returns How many records of the kind are stored on this device but
   *   cannot be read by this version of the app. They are left untouched.
   */
  unreadable(kind: RecordKind): Promise<number>;
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

/** A {@link RecordStore} that keeps records in memory only. */
export class MemoryRecordStore implements RecordStore {
  // One map per kind, each typed to that kind's records.
  #records: { [K in RecordKind]: Map<string, RecordKinds[K]> } = {
    "journal-entry": new Map(),
  };
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

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  lock(): void {
    this.#records = { "journal-entry": new Map() };
    this.#changed();
  }
}
