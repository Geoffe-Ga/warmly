/**
 * Editing a completed journal entry in place (PRD JR-006; AC-06).
 *
 * An edit overwrites the entry. Its ID, creation time and day stay as they
 * were; the time of the last change and the content hash are worked out
 * again. The old text is not kept anywhere: there is no history and no undo.
 */
import type { EventBus } from "../events";
import type { RecordStore } from "../../storage/record-store";
import { completedFrom, type EntryContent } from "./drafts";
import { inListOrder } from "./feelings";
import { PROMPTS } from "./prompts";
import type { JournalEntry } from "./types";
import { canComplete } from "./validation";

/** There is no completed entry with that ID on this device. */
export class EntryNotFoundError extends Error {
  constructor() {
    super("There is no completed entry with that ID");
    this.name = "EntryNotFoundError";
  }
}

/** The edit would leave an answer empty. Nothing was changed. */
export class IncompleteEntryError extends Error {
  constructor() {
    super("Every answer needs some text");
    this.name = "IncompleteEntryError";
  }
}

function sameContent(entry: JournalEntry, content: EntryContent): boolean {
  const feelings = inListOrder(content.feelings);
  const stored = entry.feelings ?? [];
  return (
    PROMPTS.every(
      (prompt) => entry.responses[prompt.key] === content.responses[prompt.key],
    ) &&
    stored.length === feelings.length &&
    stored.every((feeling, index) => feeling === feelings[index])
  );
}

/**
 * Change what a completed entry says.
 *
 * The same rule as completing applies: every answer needs some text. When
 * the text changes, a `journal.changed` event is announced after the entry
 * is stored, with the old and new content hashes, so that work built from
 * the old text can be dealt with. Changing only the feelings stores the
 * entry but announces nothing, because the hash does not cover feelings.
 *
 * Once the entry is stored the edit has succeeded, whatever a listener
 * does. A listener that fails is not reported as a failed edit: whatever
 * depends on the entry also checks its stored hash when the app is next
 * unlocked (see `events.ts`).
 *
 * @param deps - The record store and the event bus.
 * @param id - The entry's ID.
 * @param content - The new answers and feelings.
 * @param now - The current time.
 * @returns The entry as stored. If nothing changed, the entry as it was.
 * @throws EntryNotFoundError if there is no completed entry with that ID.
 *   A draft is changed on the compose screen, not here.
 * @throws IncompleteEntryError if an answer would be left empty.
 */
export async function editEntry(
  deps: { readonly records: RecordStore; readonly events: EventBus },
  id: string,
  content: EntryContent,
  now: Date = new Date(),
): Promise<JournalEntry> {
  const existing = await deps.records.get("journal-entry", id);
  if (existing?.status !== "complete") {
    throw new EntryNotFoundError();
  }
  if (!canComplete(content.responses)) {
    throw new IncompleteEntryError();
  }
  if (sameContent(existing, content)) {
    return existing;
  }
  const edited = await completedFrom(content, existing, now);
  await deps.records.put("journal-entry", edited);
  if (edited.contentHash !== existing.contentHash) {
    await deps.events.emit("journal.changed", {
      entryId: id,
      oldHash: existing.contentHash,
      newHash: edited.contentHash,
    });
  }
  return edited;
}
