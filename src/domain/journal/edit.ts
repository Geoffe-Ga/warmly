/**
 * Editing a completed journal entry in place (PRD JR-006; AC-06).
 *
 * An edit overwrites the entry. Its ID, creation time and day stay as they
 * were; the time of the last change and the content hash are worked out
 * again. The old text is not kept anywhere: there is no history and no undo.
 */
import type { EventBus } from "../events";
import { StaleRecordError, type RecordStore } from "../../storage/record-store";
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

/** What an edit may be told besides the new content. */
export interface EditOptions {
  /** The current time. */
  readonly now?: Date;
  /**
   * The entry as the person was shown it: the very object the record
   * store gave the screen. If the store holds a different copy by the time
   * the edit is saved, the entry was changed in between and the edit is
   * refused (no last-write-wins, invariant 5; ADR-0016).
   */
  readonly seen?: JournalEntry;
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
 * @param options - See {@link EditOptions}.
 * @returns The entry as stored. If nothing changed, the entry as it was.
 * @throws EntryNotFoundError if there is no completed entry with that ID.
 *   A draft is changed on the compose screen, not here.
 * @throws IncompleteEntryError if an answer would be left empty.
 * @throws StaleRecordError if `options.seen` is given and the entry no
 *   longer says that. Nothing is stored.
 */
export async function editEntry(
  deps: { readonly records: RecordStore; readonly events: EventBus },
  id: string,
  content: EntryContent,
  options: EditOptions = {},
): Promise<JournalEntry> {
  const existing = await deps.records.get("journal-entry", id);
  if (existing?.status !== "complete") {
    throw new EntryNotFoundError();
  }
  if (options.seen !== undefined && options.seen !== existing) {
    // The entry is not the one the person was shown: it was changed by
    // sync or in another tab while the form was open. It is not replaced
    // by words written without seeing it. Checked here as well as in the
    // write, so that an edit that changes nothing is refused too.
    throw new StaleRecordError();
  }
  if (!canComplete(content.responses)) {
    throw new IncompleteEntryError();
  }
  if (sameContent(existing, content)) {
    return existing;
  }
  const edited = await completedFrom(content, existing, options.now);
  // The store refuses this write if the entry is no longer `existing`,
  // whatever happened while the new entry was being prepared.
  await deps.records.put("journal-entry", edited, existing);
  if (edited.contentHash !== existing.contentHash) {
    await deps.events.emit("journal.changed", {
      entryId: id,
      oldHash: existing.contentHash,
      newHash: edited.contentHash,
    });
  }
  return edited;
}
