/**
 * Pieces shared by the journal screens: reading entries from the store and
 * writing an entry's date.
 */
import { useEffect, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import type { EntryDate, JournalEntry } from "../../../domain/journal/types";

/** Shown on every journal screen until entries are stored for good. */
export const NOT_SAVED_YET =
  "Entries are kept only until Warmly locks or this page reloads. Saving them for good is not built yet.";

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
 * most recently created first.
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
      right.createdAt.localeCompare(left.createdAt),
  );
}

/**
 * Read every journal entry, and read them again whenever the store changes.
 *
 * @returns The entries in timeline order, or `undefined` while loading.
 */
export function useJournalEntries(): readonly JournalEntry[] | undefined {
  const { records } = useServices();
  const [entries, setEntries] = useState<readonly JournalEntry[] | undefined>(
    undefined,
  );

  useEffect(() => {
    let current = true;
    const load = (): void => {
      void records.list("journal-entry").then((found) => {
        if (current) {
          setEntries(inTimelineOrder(found));
        }
      });
    };
    load();
    const unsubscribe = records.subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [records]);

  return entries;
}
