/**
 * Collections, cards and Reflect sessions that were changed in two places
 * (PRD SYNC-005, invariant 5; ADR-0006).
 *
 * The rules are the journal's: both versions are kept until the person
 * chooses, nothing is merged or chosen for them, and a deleted record never
 * comes back under its ID. The choices are simpler than for an entry,
 * because a card is short: keep one version or the other.
 *
 * Whichever version of a collection is kept, no card is lost: a card that
 * belongs to a collection is shown even when the collection's list does
 * not name it (see `orderCards`).
 */
import { keptCardsCollection } from "../domain/cards/collections";
import type { CardCollection, ConversationCard } from "../domain/cards/types";
import type { PostConversationReflection } from "../domain/post-conversation/types";
import type { ReflectSession } from "../domain/reflect/types";
import type {
  Keep,
  RecordConflict,
  RecordStore,
} from "../storage/record-store";
import { ConflictGoneError, type ConflictKind } from "./conflicts";

export { KEPT_CARDS_NAME } from "../domain/cards/collections";

interface Base {
  /** The record's ID. */
  readonly id: string;
  /** The server's revision of the other version, as it was when listed. */
  readonly revision: number;
  readonly kind: ConflictKind;
}

/** A collection with two versions. */
export interface CollectionConflict extends Base {
  readonly record: "card-collection";
  readonly mine?: CardCollection;
  readonly theirs?: CardCollection;
}

/** A card with two versions. */
export interface CardConflict extends Base {
  readonly record: "conversation-card";
  readonly mine?: ConversationCard;
  readonly theirs?: ConversationCard;
}

/** A Reflect session with two versions. */
export interface SessionConflict extends Base {
  readonly record: "reflect-session";
  readonly mine?: ReflectSession;
  readonly theirs?: ReflectSession;
}

/** Something written after a conversation, with two versions. */
export interface AfterConflict extends Base {
  readonly record: "post-conversation";
  readonly mine?: PostConversationReflection;
  readonly theirs?: PostConversationReflection;
}

/**
 * A collection, a card, a Reflect session or something written after a
 * conversation, waiting for the person to choose a version. (The name is
 * from when this covered cards only.)
 */
export type CardsConflict =
  CollectionConflict | CardConflict | SessionConflict | AfterConflict;

function kindOf(found: RecordConflict<unknown>): ConflictKind {
  if (found.mine !== undefined && found.theirs !== undefined) {
    return "edited";
  }
  if (found.theirsDeleted) {
    return "deleted-elsewhere";
  }
  return found.theirs === undefined ? "unreadable" : "deleted-here";
}

function describe<R extends CardsConflict["record"], T>(
  record: R,
  found: RecordConflict<T>,
): Base & { record: R; mine?: T; theirs?: T } {
  return {
    record,
    id: found.id,
    revision: found.revision,
    kind: kindOf(found),
    ...(found.mine === undefined ? {} : { mine: found.mine }),
    ...(found.theirs === undefined ? {} : { theirs: found.theirs }),
  };
}

/**
 * The collections and cards waiting for the person to choose a version.
 *
 * @param records - The record store.
 * @returns Collections first, then cards, then Reflect sessions, then
 *   what was written after conversations.
 */
export async function listCardConflicts(
  records: RecordStore,
): Promise<CardsConflict[]> {
  const [collections, cards, sessions, after] = await Promise.all([
    records.conflicts("card-collection"),
    records.conflicts("conversation-card"),
    records.conflicts("reflect-session"),
    records.conflicts("post-conversation"),
  ]);
  return [
    ...collections.map((found) => describe("card-collection", found)),
    ...cards.map((found) => describe("conversation-card", found)),
    ...sessions.map((found) => describe("reflect-session", found)),
    ...after.map((found) => describe("post-conversation", found)),
  ];
}

/**
 * Keep one version of a collection or card.
 *
 * - Both versions exist: `mine` sends this device's version on top of the
 *   other; `theirs` replaces this device's with the other.
 * - Deleted on the other device: only `theirs` (delete it here too) is
 *   possible. To keep what this device has, use {@link keepAsNew}.
 * - Deleted here: `mine` deletes it everywhere; `theirs` takes the deletion
 *   back and keeps the other device's version.
 *
 * @param records - The record store.
 * @param conflict - The conflict as the person was shown it.
 * @param keep - Which version to keep.
 * @throws ConflictGoneError if it is not waiting for a choice any more.
 * @throws ConflictChangedError if the other version has changed since.
 * @throws RecordDeletedError if keeping this device's version would bring
 *   back a record deleted elsewhere.
 */
export async function chooseVersion(
  records: RecordStore,
  conflict: CardsConflict,
  keep: Keep,
): Promise<void> {
  const settled = await records.resolve(
    conflict.record,
    conflict.id,
    keep,
    conflict.revision,
  );
  if (!settled) {
    throw new ConflictGoneError();
  }
}

async function homeFor(
  records: RecordStore,
  card: ConversationCard,
  now: Date,
): Promise<CardCollection> {
  const own = await records.get("card-collection", card.collectionId);
  // Its collection is gone, so the card needs somewhere to be seen.
  return own ?? keptCardsCollection({ records }, now);
}

/**
 * A collection or card was deleted on another device after it was changed
 * here. Keep what this device has, as a new one, and let the old one stay
 * deleted.
 *
 * A kept card goes back into its collection if that is still here, and
 * otherwise into a collection called "Kept cards". A kept collection keeps
 * its name and starts with no cards: its cards were deleted with it on the
 * other device, and any that were changed here are settled one by one. A
 * kept Reflect session keeps all of its questions and answers.
 *
 * The copy is stored first, so if anything fails the words exist twice,
 * never not at all.
 *
 * @param records - The record store.
 * @param conflict - The conflict as the person was shown it.
 * @param now - The current time.
 * @throws ConflictGoneError if it is not waiting for this choice.
 * @throws ConflictChangedError if the other version has changed since.
 */
export async function keepAsNew(
  records: RecordStore,
  conflict: CardsConflict,
  now: Date = new Date(),
): Promise<void> {
  if (conflict.kind !== "deleted-elsewhere" || conflict.mine === undefined) {
    throw new ConflictGoneError();
  }
  const at = now.toISOString();
  const id = crypto.randomUUID();
  if (conflict.record === "card-collection") {
    await records.put("card-collection", {
      ...conflict.mine,
      id,
      cardIds: [],
      updatedAt: at,
    });
  } else if (conflict.record === "reflect-session") {
    // The same questions and answers, as a separate reflection.
    await records.put("reflect-session", {
      ...conflict.mine,
      id,
      updatedAt: at,
    });
  } else if (conflict.record === "post-conversation") {
    // The same words, written on the same day, under a new ID.
    await records.put("post-conversation", {
      ...conflict.mine,
      id,
      updatedAt: at,
    });
  } else {
    const home = await homeFor(records, conflict.mine, now);
    await records.put("conversation-card", {
      ...conflict.mine,
      id,
      collectionId: home.id,
      updatedAt: at,
    });
  }
  try {
    await chooseVersion(records, conflict, "theirs");
  } catch (error) {
    // The old one was not settled, so the copy would be a second one.
    await records.delete(conflict.record, id);
    throw error;
  }
}
