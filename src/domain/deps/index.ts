/**
 * Which records were built from which journal entries (PRD DEP-001 to
 * DEP-003; decision D-13, ADR-0010).
 *
 * Nothing about this is stored. A derived record, such as a Reflect
 * session, already says inside its own encrypted content which entries it
 * was built from and what each entry's content hash was then. The index
 * is worked out from the records, in memory, whenever it is needed, so
 * there is one source of truth and it cannot drift between devices. It is
 * gone when the app locks, like everything else decrypted.
 *
 * This module knows nothing about AI. A kind of record takes part by
 * giving a rule that reads its sources.
 */
import type {
  RecordKind,
  RecordKinds,
  RecordStore,
} from "../../storage/record-store";

/** One journal entry a record was built from, and its hash at the time. */
export interface DerivedSource {
  readonly entryId: string;
  readonly sourceHash: string;
}

/** A derived record and what it was built from. */
export interface Dependent {
  readonly kind: RecordKind;
  readonly id: string;
  readonly sources: readonly DerivedSource[];
}

/** How one kind of derived record says what it was built from. */
export interface DependencyRule {
  readonly kind: RecordKind;
  /**
   * @param records - The record store.
   * @returns Every record of this kind with the entries it was built from.
   */
  readonly dependents: (records: RecordStore) => Promise<Dependent[]>;
}

/**
 * Make the rule for one kind of record.
 *
 * @param kind - The kind of derived record.
 * @param sources - Reads, from one record of that kind, every entry it
 *   was built from, cited or not.
 * @returns The rule.
 */
export function ruleFor<K extends RecordKind>(
  kind: K,
  sources: (record: RecordKinds[K]) => readonly DerivedSource[],
): DependencyRule {
  return {
    kind,
    dependents: async (records) =>
      (await records.list(kind)).map((record) => ({
        kind,
        id: record.id,
        sources: sources(record),
      })),
  };
}

/** The derived records on this device, by the entries they rest on. */
export interface DependencyIndex {
  /** Every derived record. */
  readonly dependents: readonly Dependent[];
  /**
   * @param entryId - A journal entry.
   * @returns The records built from it.
   */
  readonly of: (entryId: string) => readonly Dependent[];
}

/**
 * Work out the index from the records as they are now.
 *
 * @param records - The record store.
 * @param rules - One rule for each kind of derived record.
 * @returns The index. It is a snapshot: build it again after a change.
 */
export async function buildIndex(
  records: RecordStore,
  rules: readonly DependencyRule[],
): Promise<DependencyIndex> {
  const dependents = (
    await Promise.all(rules.map((rule) => rule.dependents(records)))
  ).flat();
  const byEntry = new Map<string, Dependent[]>();
  for (const dependent of dependents) {
    for (const entryId of new Set(dependent.sources.map((s) => s.entryId))) {
      byEntry.set(entryId, [...(byEntry.get(entryId) ?? []), dependent]);
    }
  }
  return {
    dependents,
    of: (entryId) => byEntry.get(entryId) ?? [],
  };
}
