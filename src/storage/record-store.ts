/**
 * Where the app keeps its private records (PRD SYNC-001, §7).
 *
 * Screens depend on the {@link RecordStore} interface only. For now the one
 * implementation keeps records in memory, so nothing survives a reload or a
 * lock. The encrypted store that replaces it writes ciphertext to IndexedDB
 * behind the same interface.
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
  readonly #seed: readonly JournalEntry[];
  readonly #records = new Map<RecordKind, Map<string, JournalEntry>>();
  readonly #listeners = new Set<() => void>();

  /**
   * @param seed - Entries the store starts with, and returns to when it is
   *   locked. Only ever synthetic examples: nothing a person wrote.
   */
  constructor(seed: readonly JournalEntry[] = []) {
    this.#seed = seed;
    this.#reset();
  }

  #reset(): void {
    this.#records.clear();
    this.#records.set(
      "journal-entry",
      new Map(this.#seed.map((entry) => [entry.id, entry])),
    );
  }

  #kind(kind: RecordKind): Map<string, JournalEntry> {
    let records = this.#records.get(kind);
    if (records === undefined) {
      records = new Map();
      this.#records.set(kind, records);
    }
    return records;
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

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  lock(): void {
    // Everything written since the start is dropped. Only the synthetic
    // examples, which were never private, come back.
    this.#reset();
    this.#changed();
  }
}
