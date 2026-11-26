/**
 * Removing what was built from a journal entry that has since been
 * changed or deleted (PRD DEP-002, DEP-003, DEP-005, SYNC-006, SYNC-007;
 * AC-12, AC-17; invariant 6; ADR-0010).
 *
 * An AI answer was written from particular words. When those words are
 * changed or deleted, the answer may still repeat or paraphrase them, so
 * it goes too. This is decided on the device, from what the device holds,
 * and carried out as an ordinary deletion that syncs like any other. No
 * server reads the dependency, and nothing is ever regenerated: this
 * module cannot reach AI, and a test checks that it imports none of it.
 *
 * The rule is a function of local state and nothing else, so it gives the
 * same answer however often it is run and in whatever order changes
 * arrive, and every device comes to the same result:
 *
 * A derived record is stale when an entry it was built from
 * - is known to be deleted, or
 * - is here, is settled, and its content hash is not the one recorded.
 *
 * An entry that is not here and not known to be deleted says nothing: sync
 * may not have fetched it yet. An entry that was changed in two places and
 * is waiting for the person to choose says nothing either, until they
 * choose. An entry this version of the app cannot read says nothing.
 */
import type { RecordKind, RecordStore } from "../../storage/record-store";
import { buildIndex, type Dependent, type DependencyRule } from "./index";

/** A record that was removed, or would be. Only its kind and ID. */
export interface StaleRecord {
  readonly kind: RecordKind;
  readonly id: string;
}

/** What is known about the journal's entries, for deciding staleness. */
interface Journal {
  /** The content hash of each settled entry that is here, by ID. */
  readonly hashes: ReadonlyMap<string, string>;
  /** Entries known to be deleted. */
  readonly deleted: ReadonlySet<string>;
  /** Entries waiting for the person to choose between two versions. */
  readonly unsettled: ReadonlySet<string>;
}

async function readJournal(records: RecordStore): Promise<Journal> {
  const [entries, deleted, conflicts] = await Promise.all([
    records.list("journal-entry"),
    records.deleted("journal-entry"),
    records.conflicts("journal-entry"),
  ]);
  return {
    hashes: new Map(entries.map((entry) => [entry.id, entry.contentHash])),
    deleted: new Set(deleted),
    unsettled: new Set(conflicts.map((conflict) => conflict.id)),
  };
}

function isStale(dependent: Dependent, journal: Journal): boolean {
  return dependent.sources.some(({ entryId, sourceHash }) => {
    if (journal.unsettled.has(entryId)) {
      return false;
    }
    if (journal.deleted.has(entryId)) {
      return true;
    }
    const now = journal.hashes.get(entryId);
    return now !== undefined && now !== sourceHash;
  });
}

/**
 * Find the derived records that are stale. Reads only; changes nothing.
 *
 * @param records - The record store.
 * @param rules - One rule for each kind of derived record.
 * @returns The stale records, in no particular order.
 */
export async function findStale(
  records: RecordStore,
  rules: readonly DependencyRule[],
): Promise<StaleRecord[]> {
  const [index, journal] = await Promise.all([
    buildIndex(records, rules),
    readJournal(records),
  ]);
  return index.dependents
    .filter((dependent) => isStale(dependent, journal))
    .map(({ kind, id }) => ({ kind, id }));
}

/**
 * Delete every stale derived record. Each is deleted whole, as an ordinary
 * deletion that syncs. Running it again straight away does nothing.
 *
 * @param records - The record store.
 * @param rules - One rule for each kind of derived record.
 * @returns What was deleted.
 */
export async function invalidate(
  records: RecordStore,
  rules: readonly DependencyRule[],
): Promise<StaleRecord[]> {
  const stale = await findStale(records, rules);
  for (const { kind, id } of stale) {
    await records.delete(kind, id);
  }
  return stale;
}

/**
 * Keeps derived records honest while the app is unlocked: runs
 * {@link invalidate} when started and again after every change to the
 * records, whether made here or brought by sync.
 */
export class Invalidator {
  readonly #records: RecordStore;
  readonly #rules: readonly DependencyRule[];
  readonly #listeners = new Set<() => void>();
  #stop: (() => void) | undefined;
  #running: Promise<void> | undefined;
  #again = false;
  #removed = 0;

  /**
   * @param records - The record store.
   * @param rules - One rule for each kind of derived record.
   */
  constructor(records: RecordStore, rules: readonly DependencyRule[]) {
    this.#records = records;
    this.#rules = rules;
  }

  /**
   * How many records have been removed since the person was last told.
   * A count and nothing else: never which, or what they said.
   */
  get removed(): number {
    return this.#removed;
  }

  /**
   * Be told when {@link Invalidator.removed} changes.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #tell(): void {
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  /** The person has read the notice. */
  acknowledge(): void {
    if (this.#removed !== 0) {
      this.#removed = 0;
      this.#tell();
    }
  }

  /** Start watching. Called when the app unlocks; safe to call twice. */
  start(): void {
    if (this.#stop === undefined) {
      this.#stop = this.#records.subscribe(() => {
        void this.run();
      });
      void this.run();
    }
  }

  /** Stop watching and forget the count. Called when the app locks. */
  stop(): void {
    this.#stop?.();
    this.#stop = undefined;
    this.#removed = 0;
    this.#tell();
  }

  /**
   * Check now. One check runs at a time: a change that arrives while one
   * is running is picked up by one more check straight after it.
   *
   * @returns When the records have been checked. It never rejects: a
   *   check that cannot read the records is tried again at the next
   *   change, and nothing is removed on a guess.
   */
  run(): Promise<void> {
    if (this.#running !== undefined) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#check().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  async #check(): Promise<void> {
    do {
      this.#again = false;
      try {
        const gone = await invalidate(this.#records, this.#rules);
        if (gone.length > 0 && this.#stop !== undefined) {
          this.#removed += gone.length;
          this.#tell();
        }
      } catch {
        // The records could not be read or written just now, for example
        // because the app locked meanwhile. Nothing was removed by guess.
        return;
      }
    } while (this.#again);
  }
}
