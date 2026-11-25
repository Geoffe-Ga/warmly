/**
 * Pieces shared by the journal screens: reading entries from the store and
 * writing an entry's date.
 */
import { useEffect, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import type { EntryDate, JournalEntry } from "../../../domain/journal/types";

/** Said when this device's saved records cannot be opened at all. */
export const CANNOT_OPEN =
  "Warmly couldn't open what is saved on this device. Nothing has been changed or deleted. Close other Warmly tabs and reload this page; if a newer version of Warmly has been used here, update to it.";

/**
 * Write an entry's day for people, such as "November 10, 2026".
 *
 * @param entryDate - The day the entry is about.
 * @returns The date in the device's language.
 */
export function formatEntryDate(entryDate: EntryDate): string {
  // The stored day is already in the writer's time zone, so it is read back
  // as that calendar day and never shifted into another zone.
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${entryDate.date}T00:00:00Z`));
}

/**
 * Put entries in timeline order: newest day first, and within a day the
 * most recently created first. Entries created at the same instant are
 * ordered by ID, so the order never changes from one reading to the next.
 *
 * @param entries - The entries, in any order.
 * @returns A new, sorted array.
 */
export function inTimelineOrder(
  entries: readonly JournalEntry[],
): JournalEntry[] {
  return [...entries].sort(
    (left, right) =>
      right.entryDate.date.localeCompare(left.entryDate.date) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/** What the journal screens know about the stored entries. */
export type Journal =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      /** The entries, in timeline order. */
      readonly entries: readonly JournalEntry[];
      /** How many stored entries this version of the app cannot read. */
      readonly unreadable: number;
    };

/**
 * Read every journal entry, and read them again whenever the store changes.
 *
 * @returns The entries, or that they are loading or could not be opened.
 */
export function useJournalEntries(): Journal {
  const { records } = useServices();
  const [journal, setJournal] = useState<Journal>({ state: "loading" });

  useEffect(() => {
    let current = true;
    const load = (): void => {
      void Promise.all([
        records.list("journal-entry"),
        records.unreadable("journal-entry"),
      ]).then(
        ([found, unreadable]) => {
          if (current) {
            setJournal({
              state: "ready",
              entries: inTimelineOrder(found),
              unreadable,
            });
          }
        },
        () => {
          if (current) {
            setJournal({ state: "failed" });
          }
        },
      );
    };
    load();
    const unsubscribe = records.subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [records]);

  return journal;
}
