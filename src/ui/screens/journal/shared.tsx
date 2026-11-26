/**
 * Pieces shared by the journal screens: reading entries from the store,
 * writing an entry's date, and the words said before anything is deleted.
 */
import { useEffect, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import type { EntryDate, JournalEntry } from "../../../domain/journal/types";
import type { PostConversationReflection } from "../../../domain/post-conversation/types";
import { describeOpenFailure } from "../../storage-messages";

export { CANNOT_OPEN } from "../../storage-messages";

/**
 * What deleting does, said before the person confirms (JR-007, OPS-003).
 *
 * This text must be true. It describes sync and backups: check it against
 * what they really do when sync ships (#32) and when backup retention is
 * verified (#65), and change it and its tests if they differ.
 */
export const DELETE_WARNING =
  "This deletes it from this device now, and from your other devices the next time they sync. There is no trash and no undo. Encrypted copies held in backups cannot be read by anyone but you, and are removed as those backups expire, within 30 days.";

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
  | {
      readonly state: "failed";
      /** Why the entries could not be opened, in words for the person. */
      readonly message: string;
    }
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
        (error: unknown) => {
          if (current) {
            setJournal({
              state: "failed",
              message: describeOpenFailure(error),
            });
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

/**
 * The reflections written after conversations, read again whenever the
 * store changes. If they cannot be read, the journal is still shown.
 *
 * @returns The reflections; none until they have been read.
 */
export function useAfterReflections(): readonly PostConversationReflection[] {
  const { records } = useServices();
  const [found, setFound] = useState<readonly PostConversationReflection[]>([]);
  useEffect(() => {
    let current = true;
    const load = (): void => {
      records.list("post-conversation").then(
        (listed) => {
          if (current) {
            setFound(listed);
          }
        },
        () => {
          if (current) {
            setFound([]);
          }
        },
      );
    };
    load();
    const stop = records.subscribe(load);
    return () => {
      current = false;
      stop();
    };
  }, [records]);
  return found;
}
