/**
 * Writing, changing and deleting the person's own cards (PRD CC-010,
 * CC-011; AC-13).
 *
 * A manual card is `user_owned`: it carries no AI attribution, and making
 * or changing one never calls AI or the network. There is no limit on how
 * many cards a collection holds; the limit of three is for one AI request.
 * The words are the person's: nothing here corrects, scores or blocks them.
 */
import { StaleRecordError, type RecordStore } from "../../storage/record-store";
import { readingText, type CardType, type ConversationCard } from "./types";

/** The longest a card's text may be, in characters. */
export const MAX_CARD_TEXT = 4000;

/** A card's text was empty or too long. Nothing was changed. */
export class InvalidCardTextError extends Error {
  constructor() {
    super("A card needs some text, up to 4000 characters");
    this.name = "InvalidCardTextError";
  }
}

/** What the person writes when making or changing a card. */
export interface CardDraft {
  readonly type: CardType;
  readonly text: string;
}

interface Deps {
  readonly records: RecordStore;
}

/**
 * Check the words of a card and trim the spaces at their ends. The same
 * limits apply however the words arrive: typed by the person, or picked
 * from AI's suggestions.
 *
 * @param text - The words.
 * @returns The words, trimmed.
 * @throws InvalidCardTextError if they are empty or too long.
 */
export function cleanCardText(text: string): string {
  const clean = text.trim();
  // Counted as the person sees them: an emoji is one character.
  if (clean === "" || [...clean].length > MAX_CARD_TEXT) {
    throw new InvalidCardTextError();
  }
  return clean;
}

/**
 * Write a new card at the end of a collection.
 *
 * The card is stored first and then added to the collection's list. If
 * the second step does not happen the card is still shown, after the
 * listed ones (see `orderCards`), so it is never lost.
 *
 * @param deps - The record store.
 * @param collectionId - The collection to add it to.
 * @param draft - Its kind and its words.
 * @param now - The current time.
 * @returns The card, or `undefined` if the collection is not here.
 * @throws InvalidCardTextError if the text is empty or too long.
 */
export async function createCard(
  deps: Deps,
  collectionId: string,
  draft: CardDraft,
  now: Date = new Date(),
): Promise<ConversationCard | undefined> {
  const text = cleanCardText(draft.text);
  const collection = await deps.records.get("card-collection", collectionId);
  if (collection === undefined) {
    return undefined;
  }
  const made = now.toISOString();
  const card: ConversationCard = {
    id: crypto.randomUUID(),
    collectionId,
    type: draft.type,
    authorship: "user_owned",
    segments: [{ id: crypto.randomUUID(), category: "other", text }],
    sourceEntryIds: [],
    createdAt: made,
    updatedAt: made,
  };
  await deps.records.put("conversation-card", card);
  await deps.records.put("card-collection", {
    ...collection,
    cardIds: [...collection.cardIds, card.id],
    updatedAt: made,
  });
  return card;
}

/** What a change to a card's words may be told besides the new words. */
export interface CardEditOptions {
  /** The current time. */
  readonly now?: Date;
  /**
   * The card as the person was shown it: the very object the record
   * store gave the screen. If the store holds a different copy by the time
   * the change is saved, the card was changed in between and the change is
   * refused (no last-write-wins, invariant 5; ADR-0016).
   */
  readonly seen?: ConversationCard;
}

/**
 * Refuse a change to a card that is no longer the one the person was
 * shown: sync or another tab changed it while the form was open.
 *
 * @param existing - The card as the store holds it now.
 * @param seen - The card as the form was filled from it, if known.
 * @throws StaleRecordError if the store holds a different copy.
 */
export function refuseIfChanged(
  existing: ConversationCard,
  seen: ConversationCard | undefined,
): void {
  if (seen !== undefined && seen !== existing) {
    throw new StaleRecordError();
  }
}

/**
 * Rewrite a whole card as one text: its kind, its words, or both.
 *
 * The card becomes one plain part holding the new words, and it is the
 * person's own from then on (decision D-15). Everything the AI said about
 * a card it drafted goes with the old parts: the quotes, the explanations
 * and every reference to the journal (PRD DEP-004). A card drafted by AI
 * that is saved with exactly the words and kind it already has is left as
 * it is, so pressing Save on its own changes nothing.
 *
 * @param deps - The record store.
 * @param cardId - The card's ID.
 * @param draft - Its kind and its words.
 * @param options - See {@link CardEditOptions}.
 * @returns The card as it now is, or `undefined` if it is not here.
 * @throws InvalidCardTextError if the text is empty or too long.
 * @throws StaleRecordError if `options.seen` is given and the card is no
 *   longer that. Nothing is stored.
 */
export async function editCard(
  deps: Deps,
  cardId: string,
  draft: CardDraft,
  options: CardEditOptions = {},
): Promise<ConversationCard | undefined> {
  const text = cleanCardText(draft.text);
  const existing = await deps.records.get("conversation-card", cardId);
  if (existing === undefined) {
    return undefined;
  }
  refuseIfChanged(existing, options.seen);
  if (
    existing.authorship === "ai_generated" &&
    draft.type === existing.type &&
    text === readingText(existing)
  ) {
    return existing;
  }
  const changed: ConversationCard = {
    id: existing.id,
    collectionId: existing.collectionId,
    type: draft.type,
    authorship: "user_owned",
    segments: [
      {
        id: existing.segments[0]?.id ?? crypto.randomUUID(),
        category: "other",
        text,
      },
    ],
    sourceEntryIds: [],
    createdAt: existing.createdAt,
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
  await deps.records.put("conversation-card", changed, existing);
  return changed;
}

/**
 * Delete a card for good. There is no trash and no undo; the caller asks
 * the person first.
 *
 * @param deps - The record store.
 * @param cardId - The card's ID.
 * @param now - The current time.
 * @returns Whether there was a card to delete.
 */
export async function deleteCard(
  deps: Deps,
  cardId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const existing = await deps.records.get("conversation-card", cardId);
  if (existing === undefined) {
    return false;
  }
  await deps.records.delete("conversation-card", cardId);
  // Tidy the collection's list. A stale ID left in it would be harmless:
  // a listed card that does not exist is skipped.
  const collection = await deps.records.get(
    "card-collection",
    existing.collectionId,
  );
  if (collection?.cardIds.includes(cardId) === true) {
    await deps.records.put("card-collection", {
      ...collection,
      cardIds: collection.cardIds.filter((each) => each !== cardId),
      updatedAt: now.toISOString(),
    });
  }
  return true;
}
