/**
 * Example journal entries for development and the `e2e` build. They must
 * never be part of a production build.
 *
 * Every answer says it is an example, so a seeded entry can never be taken
 * for something a person wrote.
 */
import type { JournalEntry } from "../domain/journal/types";

function example(
  number: number,
  day: string,
  responses: JournalEntry["responses"],
): JournalEntry {
  return {
    id: `00000000-0000-4000-8000-00000000000${String(number)}`,
    createdAt: `${day}T09:00:00.000Z`,
    entryDate: { date: day, timeZone: "UTC" },
    updatedAt: `${day}T09:00:00.000Z`,
    status: "complete",
    responses,
    // A placeholder: the examples are never quoted or checked.
    contentHash: "0".repeat(64),
  };
}

/**
 * The entries a development build's journal starts with.
 *
 * A function, not a constant: nothing runs when this module is loaded, so a
 * production build, which never calls it, drops the examples entirely.
 *
 * @returns The example entries.
 */
export function seedJournal(): JournalEntry[] {
  return [
    example(1, "2026-11-03", {
      good: "Example entry: we cooked dinner together twice this week.",
      improve: "Example entry: I would like us to plan weekends earlier.",
      loved: "Example entry: a note was left on the fridge for me.",
    }),
    example(2, "2026-11-10", {
      good: "Example entry: the walk on Sunday was a good idea.",
      improve: "Example entry: nothing comes to mind this week.",
      loved: "Example entry: I was asked how my day went, and listened to.",
    }),
  ];
}
