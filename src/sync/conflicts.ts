/**
 * Journal entries that were changed in two places, and how the person
 * settles them (PRD SYNC-004, SYNC-010; AC-16; ADR-0006).
 *
 * When sync finds that an entry changed on this device and on another one
 * from the same starting point, nothing is merged and nobody's version
 * wins. This device keeps its own version and, beside it, the version the
 * server holds. The person reads both here and keeps one, or writes a
 * version of their own. Only then is the other one removed.
 *
 * Everything happens on this device. Nothing here calls AI.
 */
import type { EntryContent } from "../domain/journal/drafts";
import { completedFrom, draftFrom } from "../domain/journal/drafts";
import type { EventBus } from "../domain/events";
import type { JournalEntry } from "../domain/journal/types";
import { canComplete } from "../domain/journal/validation";
import type { RecordConflict, RecordStore } from "../storage/record-store";

export { ConflictChangedError } from "../storage/record-store";

/**
 * What kind of difference there is.
 *
 * - `edited`: both versions exist and can be read.
 * - `deleted-elsewhere`: changed here, deleted on another device.
 * - `deleted-here`: deleted here, changed on another device.
 * - `unreadable`: the other version was written by a newer version of the
 *   app than this one.
 */
export type ConflictKind =
  "edited" | "deleted-elsewhere" | "deleted-here" | "unreadable";

/** An entry both of whose versions are there to read and choose between. */
export interface EditedConflict {
  readonly id: string;
  /** The server's revision of the other version, as it was when listed. */
  readonly revision: number;
  readonly kind: "edited";
  readonly mine: JournalEntry;
  readonly theirs: JournalEntry;
}

/** An entry where one version is deleted or cannot be read. */
export interface OtherConflict {
  readonly id: string;
  /** The server's revision of the other version, as it was when listed. */
  readonly revision: number;
  readonly kind: Exclude<ConflictKind, "edited">;
  /** This device's version, when there is one to show. */
  readonly mine?: JournalEntry;
  /** The other device's version, when there is one to show. */
  readonly theirs?: JournalEntry;
}

/** One entry with two versions. */
export type EntryConflict = EditedConflict | OtherConflict;

/** The entry is not in conflict any more, or never was. Nothing changed. */
export class ConflictGoneError extends Error {
  constructor() {
    super("That entry is not waiting for a choice");
    this.name = "ConflictGoneError";
  }
}

/** The merged entry would leave an answer empty. Nothing was changed. */
export class IncompleteMergeError extends Error {
  constructor() {
    super("Every answer needs some text");
    this.name = "IncompleteMergeError";
  }
}

/** What settling needs: the records and somewhere to announce changes. */
export interface ConflictDeps {
  readonly records: RecordStore;
  readonly events: EventBus;
}

function describe(found: RecordConflict<JournalEntry>): EntryConflict {
  const { id, mine, theirs, revision } = found;
  if (mine !== undefined && theirs !== undefined) {
    return { id, revision, kind: "edited", mine, theirs };
  }
  const kind = found.theirsDeleted
    ? "deleted-elsewhere"
    : theirs === undefined
      ? "unreadable"
      : "deleted-here";
  return {
    id,
    revision,
    kind,
    ...(mine === undefined ? {} : { mine }),
    ...(theirs === undefined ? {} : { theirs }),
  };
}

/**
 * The entries waiting for the person to choose a version.
 *
 * @param records - The record store.
 * @returns One item per entry, oldest entry first.
 */
export async function listConflicts(
  records: RecordStore,
): Promise<EntryConflict[]> {
  const created = (conflict: EntryConflict): string =>
    (conflict.mine ?? conflict.theirs)?.createdAt ?? "";
  return (await records.conflicts("journal-entry"))
    .map(describe)
    .sort((left, right) => created(left).localeCompare(created(right)));
}

/** Whether both versions of a conflict can be shown and chosen between. */
export function isEdited(conflict: EntryConflict): conflict is EditedConflict {
  return conflict.kind === "edited";
}

/**
 * Store a choice about the version the person was shown.
 *
 * @throws ConflictGoneError if the entry is no longer waiting for a choice.
 * @throws ConflictChangedError if the other version has changed since it
 *   was shown. Nothing is changed.
 */
async function settle(
  records: RecordStore,
  conflict: EditedConflict,
  keep: "mine" | "theirs",
  merged?: JournalEntry,
): Promise<void> {
  const settled = await records.resolve(
    "journal-entry",
    conflict.id,
    keep,
    conflict.revision,
    merged,
  );
  if (!settled) {
    throw new ConflictGoneError();
  }
}

/**
 * Tell whatever was built from the entry that its text is different now.
 * A completed entry that became a draft is, for that purpose, gone.
 */
async function announce(
  events: EventBus,
  before: JournalEntry,
  after: JournalEntry,
): Promise<void> {
  if (before.status !== "complete") {
    return;
  }
  if (after.status !== "complete") {
    await events.emit("journal.deleted", {
      entryId: before.id,
      oldHash: before.contentHash,
    });
  } else if (after.contentHash !== before.contentHash) {
    await events.emit("journal.changed", {
      entryId: before.id,
      oldHash: before.contentHash,
      newHash: after.contentHash,
    });
  }
}

/**
 * Keep this device's version. It is sent to the server on the next sync, on
 * top of the other version, which is removed from this device.
 *
 * @param deps - The record store and the event bus.
 * @param conflict - The conflict as the person was shown it.
 * @throws ConflictGoneError if the entry is not waiting for a choice.
 * @throws ConflictChangedError if the other version has changed since.
 */
export async function keepMine(
  deps: ConflictDeps,
  conflict: EditedConflict,
): Promise<void> {
  await settle(deps.records, conflict, "mine");
}

/**
 * Keep the other device's version. This device's version is removed and is
 * not kept anywhere.
 *
 * @param deps - The record store and the event bus.
 * @param conflict - The conflict as the person was shown it.
 * @throws ConflictGoneError if the entry is not waiting for a choice.
 * @throws ConflictChangedError if the other version has changed since.
 */
export async function keepTheirs(
  deps: ConflictDeps,
  conflict: EditedConflict,
): Promise<void> {
  await settle(deps.records, conflict, "theirs");
  await announce(deps.events, conflict.mine, conflict.theirs);
}

/**
 * Keep a version the person wrote from the two. It replaces this device's
 * version and is sent on the next sync; the other version is removed. Both
 * happen in one step: the merged text is never stored while the choice is
 * still open.
 *
 * If either version was a finished entry, the result is one too, and the
 * usual rule applies: every answer needs some text.
 *
 * @param deps - The record store and the event bus.
 * @param conflict - The conflict as the person was shown it.
 * @param content - The merged answers and feelings.
 * @param now - The current time.
 * @returns The entry as stored.
 * @throws ConflictGoneError if the entry is not waiting for a choice.
 * @throws ConflictChangedError if the other version has changed since.
 * @throws IncompleteMergeError if a finished entry would lose an answer.
 */
export async function keepMerged(
  deps: ConflictDeps,
  conflict: EditedConflict,
  content: EntryContent,
  now: Date = new Date(),
): Promise<JournalEntry> {
  const { mine, theirs } = conflict;
  const finished = mine.status === "complete" || theirs.status === "complete";
  if (finished && !canComplete(content.responses)) {
    throw new IncompleteMergeError();
  }
  const merged = await (finished
    ? completedFrom(content, mine, now)
    : draftFrom(content, mine, now));
  await settle(deps.records, conflict, "mine", merged);
  await announce(deps.events, mine, merged);
  return merged;
}
