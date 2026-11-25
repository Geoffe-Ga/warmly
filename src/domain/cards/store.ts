/**
 * Where screens get collections and cards from (PRD CC-001).
 *
 * For now this is held in memory only: nothing is saved, and a reload
 * starts again. Saving, through the encrypted record store, arrives with
 * the next step; the screens will not change, because they only know this
 * interface.
 */
import type { CardCollection, ConversationCard } from "./types";

/** Read access to the person's collections and cards. */
export interface CardsStore {
  /** @returns Every collection, in the order they were made. */
  collections(): Promise<readonly CardCollection[]>;
  /**
   * @param id - A collection's ID.
   * @returns The collection, or `undefined` if there is none with that ID.
   */
  collection(id: string): Promise<CardCollection | undefined>;
  /**
   * @param collectionId - A collection's ID.
   * @returns Its cards in the collection's order. A card the collection
   *   lists but that does not exist is left out.
   */
  cards(collectionId: string): Promise<readonly ConversationCard[]>;
  /**
   * @param collectionId - The collection the card must be in.
   * @param cardId - The card's ID.
   * @returns The card, or `undefined` if that collection has no such card.
   */
  card(
    collectionId: string,
    cardId: string,
  ): Promise<ConversationCard | undefined>;
}

/** A store that lives in memory. Empty unless it is given something. */
export class MemoryCardsStore implements CardsStore {
  readonly #collections: readonly CardCollection[];
  readonly #cards: ReadonlyMap<string, ConversationCard>;

  /**
   * @param collections - The collections to hold.
   * @param cards - Their cards.
   */
  constructor(
    collections: readonly CardCollection[] = [],
    cards: readonly ConversationCard[] = [],
  ) {
    this.#collections = collections;
    this.#cards = new Map(cards.map((card) => [card.id, card]));
  }

  collections(): Promise<readonly CardCollection[]> {
    return Promise.resolve(this.#collections);
  }

  collection(id: string): Promise<CardCollection | undefined> {
    return Promise.resolve(this.#collections.find((each) => each.id === id));
  }

  async cards(collectionId: string): Promise<readonly ConversationCard[]> {
    const collection = await this.collection(collectionId);
    return (collection?.cardIds ?? [])
      .map((cardId) => this.#cards.get(cardId))
      .filter((card) => card?.collectionId === collectionId)
      .filter((card) => card !== undefined);
  }

  async card(
    collectionId: string,
    cardId: string,
  ): Promise<ConversationCard | undefined> {
    const cards = await this.cards(collectionId);
    return cards.find((card) => card.id === cardId);
  }
}
