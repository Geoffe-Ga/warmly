/**
 * Making, renaming, reordering and deleting collections (PRD CC-001,
 * CC-010; AC-13).
 *
 * Nothing here calls AI or the network. Every change is an ordinary write
 * to the private record store, which seals it and queues it for sync.
 */
import type { RecordStore } from "../../storage/record-store";
import {
  orderCards,
  type CardCollection,
  type ConversationCard,
} from "./types";

/** The longest name a collection may have, in characters. */
export const MAX_COLLECTION_NAME = 80;

/** A collection's name was empty or too long. Nothing was changed. */
export class InvalidNameError extends Error {
  constructor() {
    super("A collection needs a name of 1 to 80 characters");
    this.name = "InvalidNameError";
  }
}

interface Deps {
  readonly records: RecordStore;
}

function cleanName(name: string): string {
  const clean = name.trim();
  // Counted as the person sees them: an emoji is one character.
  if (clean === "" || [...clean].length > MAX_COLLECTION_NAME) {
    throw new InvalidNameError();
  }
  return clean;
}

/**
 * Make a new, empty collection.
 *
 * @param deps - The record store.
 * @param name - What the person calls it.
 * @param now - The current time.
 * @returns The collection.
 * @throws InvalidNameError if the name is empty or too long.
 */
export async function createCollection(
  deps: Deps,
  name: string,
  now: Date = new Date(),
): Promise<CardCollection> {
  const made = now.toISOString();
  const collection: CardCollection = {
    id: crypto.randomUUID(),
    name: cleanName(name),
    cardIds: [],
    createdAt: made,
    updatedAt: made,
  };
  await deps.records.put("card-collection", collection);
  return collection;
}

/**
 * Give a collection a new name. Its cards are untouched.
 *
 * @param deps - The record store.
 * @param id - The collection's ID.
 * @param name - The new name.
 * @param now - The current time.
 * @returns The renamed collection, or `undefined` if it is not here.
 * @throws InvalidNameError if the name is empty or too long.
 */
export async function renameCollection(
  deps: Deps,
  id: string,
  name: string,
  now: Date = new Date(),
): Promise<CardCollection | undefined> {
  const clean = cleanName(name);
  const existing = await deps.records.get("card-collection", id);
  if (existing === undefined) {
    return undefined;
  }
  const renamed = { ...existing, name: clean, updatedAt: now.toISOString() };
  await deps.records.put("card-collection", renamed);
  return renamed;
}

/**
 * Delete a collection and every card in it, for good. There is no trash
 * and no undo; the caller asks the person first.
 *
 * The cards go first. If something stops this part-way, the collection is
 * still there with fewer cards, and deleting it again finishes the job.
 *
 * A card added to the collection at the same moment, in another tab or on
 * another device, is not in the list read here and so is not deleted. It
 * is left belonging to no collection, where the collections screen shows
 * it and the person decides (see `keepStrayCards`).
 *
 * @param deps - The record store.
 * @param id - The collection's ID.
 * @returns How many cards were deleted with it, or `undefined` if the
 *   collection is not here.
 */
export async function deleteCollection(
  deps: Deps,
  id: string,
): Promise<number | undefined> {
  const existing = await deps.records.get("card-collection", id);
  if (existing === undefined) {
    return undefined;
  }
  const cards = (await deps.records.list("conversation-card")).filter(
    (card) => card.collectionId === id,
  );
  for (const card of cards) {
    await deps.records.delete("conversation-card", card.id);
  }
  await deps.records.delete("card-collection", id);
  return cards.length;
}

/**
 * The collection that cards are kept in when their own is gone. It is an
 * ordinary collection found by this name: if the person already has one
 * called this, kept cards join it.
 */
export const KEPT_CARDS_NAME = "Kept cards";

/**
 * Find the collection for kept cards, or make it.
 *
 * @param deps - The record store.
 * @param now - The current time.
 * @returns The collection.
 */
export async function keptCardsCollection(
  deps: Deps,
  now: Date = new Date(),
): Promise<CardCollection> {
  const existing = (await deps.records.list("card-collection")).find(
    (each) => each.name === KEPT_CARDS_NAME,
  );
  if (existing !== undefined) {
    return existing;
  }
  const made = now.toISOString();
  const collection: CardCollection = {
    id: crypto.randomUUID(),
    name: KEPT_CARDS_NAME,
    cardIds: [],
    createdAt: made,
    updatedAt: made,
  };
  await deps.records.put("card-collection", collection);
  return collection;
}

function strays(
  collections: readonly CardCollection[],
  cards: readonly ConversationCard[],
): ConversationCard[] {
  const known = new Set(collections.map((each) => each.id));
  return cards.filter((card) => !known.has(card.collectionId));
}

/**
 * Keep the cards that belong to no collection, by putting them in the
 * collection for kept cards. Done only when the person asks.
 *
 * @param deps - The record store.
 * @param now - The current time.
 * @returns How many cards were moved.
 */
export async function keepStrayCards(
  deps: Deps,
  now: Date = new Date(),
): Promise<number> {
  const found = strays(
    await deps.records.list("card-collection"),
    await deps.records.list("conversation-card"),
  );
  if (found.length === 0) {
    return 0;
  }
  const home = await keptCardsCollection(deps, now);
  for (const card of found) {
    await deps.records.put("conversation-card", {
      ...card,
      collectionId: home.id,
      updatedAt: now.toISOString(),
    });
  }
  return found.length;
}

/**
 * Delete the cards that belong to no collection, for good. Done only when
 * the person asks, after a confirmation.
 *
 * @param deps - The record store.
 * @returns How many cards were deleted.
 */
export async function deleteStrayCards(deps: Deps): Promise<number> {
  const found = strays(
    await deps.records.list("card-collection"),
    await deps.records.list("conversation-card"),
  );
  for (const card of found) {
    await deps.records.delete("conversation-card", card.id);
  }
  return found.length;
}

/** Where a card ended up after a move. Positions start at 1. */
export interface Moved {
  readonly position: number;
  readonly total: number;
}

/**
 * Move a card to another place in its collection.
 *
 * The order the person sees is what is stored afterwards, so a card that
 * was not yet in the collection's list is listed from then on.
 *
 * @param deps - The record store.
 * @param collectionId - The collection's ID.
 * @param cardId - The card to move.
 * @param to - Where to put it: 1 is first. Out-of-range values are brought
 *   to the nearest end.
 * @param now - The current time.
 * @returns Where the card is now, or `undefined` if the collection or the
 *   card is not here. Nothing is written if the card does not move.
 */
export async function moveCard(
  deps: Deps,
  collectionId: string,
  cardId: string,
  to: number,
  now: Date = new Date(),
): Promise<Moved | undefined> {
  const collection = await deps.records.get("card-collection", collectionId);
  if (collection === undefined) {
    return undefined;
  }
  const order = orderCards(
    collection,
    await deps.records.list("conversation-card"),
  ).map((card) => card.id);
  const from = order.indexOf(cardId);
  if (from < 0) {
    return undefined;
  }
  const target = Math.min(Math.max(Math.trunc(to), 1), order.length) - 1;
  if (target !== from) {
    order.splice(from, 1);
    order.splice(target, 0, cardId);
    await deps.records.put("card-collection", {
      ...collection,
      cardIds: order,
      updatedAt: now.toISOString(),
    });
  }
  return { position: target + 1, total: order.length };
}
