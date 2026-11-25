/**
 * Writing, changing and deleting the person's own cards (PRD CC-010,
 * CC-011; AC-13).
 *
 * A manual card is `user_owned`: it carries no AI attribution, and making
 * or changing one never calls AI or the network. There is no limit on how
 * many cards a collection holds; the limit of three is for one AI request.
 * The words are the person's: nothing here corrects, scores or blocks them.
 */
import type { RecordStore } from "../../storage/record-store";
import type { CardType, ConversationCard } from "./types";

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

function cleanText(text: string): string {
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
  const text = cleanText(draft.text);
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

/**
 * Change one of the person's own cards: its kind, its words, or both.
 *
 * The card becomes one plain part holding the new words. A card drafted by
 * AI and not yet the person's is left alone here: taking one over has its
 * own rules.
 *
 * @param deps - The record store.
 * @param cardId - The card's ID.
 * @param draft - Its kind and its words.
 * @param now - The current time.
 * @returns The changed card, or `undefined` if it is not here or is not
 *   the person's own.
 * @throws InvalidCardTextError if the text is empty or too long.
 */
export async function editCard(
  deps: Deps,
  cardId: string,
  draft: CardDraft,
  now: Date = new Date(),
): Promise<ConversationCard | undefined> {
  const text = cleanText(draft.text);
  const existing = await deps.records.get("conversation-card", cardId);
  if (existing?.authorship !== "user_owned") {
    return undefined;
  }
  const changed: ConversationCard = {
    ...existing,
    type: draft.type,
    segments: [
      {
        id: existing.segments[0]?.id ?? crypto.randomUUID(),
        category: "other",
        text,
      },
    ],
    updatedAt: now.toISOString(),
  };
  await deps.records.put("conversation-card", changed);
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
