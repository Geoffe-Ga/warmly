/**
 * Where screens get collections and cards from (PRD CC-001, SYNC-001).
 *
 * Collections and cards are private records like journal entries: each is
 * sealed on this device, kept in the encrypted record store and synced to
 * the person's other devices. A collection and each of its cards are
 * separate records, so changing one card on one device and another card on
 * another device does not conflict.
 *
 * Screens read through this interface. Changes go through the functions in
 * `collections.ts` and `cards.ts`.
 */
import type { RecordStore } from "../../storage/record-store";
import {
  orderCards,
  type CardCollection,
  type ConversationCard,
} from "./types";

/** Read access to the person's collections and cards. */
export interface CardsStore {
  /** @returns Every collection, oldest first. */
  collections(): Promise<readonly CardCollection[]>;
  /**
   * @param id - A collection's ID.
   * @returns The collection, or `undefined` if there is none with that ID.
   */
  collection(id: string): Promise<CardCollection | undefined>;
  /**
   * @param collectionId - A collection's ID.
   * @returns Its cards, in order (see `orderCards`).
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
  /**
   * Cards that belong to no collection on this device. That happens when
   * one device deletes a collection while another is adding a card to it:
   * the card arrives, and its collection is gone. They are never hidden:
   * the collections screen shows them and offers to keep or delete them.
   *
   * @returns Those cards, oldest first.
   */
  strays(): Promise<readonly ConversationCard[]>;
  /**
   * Be told when collections or cards may have changed, here or through
   * sync.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
}

/** The cards store the app uses: a view of the private record store. */
export class RecordCardsStore implements CardsStore {
  readonly #records: RecordStore;

  /** @param records - The private record store. */
  constructor(records: RecordStore) {
    this.#records = records;
  }

  async collections(): Promise<readonly CardCollection[]> {
    const all = await this.#records.list("card-collection");
    return [...all].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }

  collection(id: string): Promise<CardCollection | undefined> {
    return this.#records.get("card-collection", id);
  }

  async cards(collectionId: string): Promise<readonly ConversationCard[]> {
    const collection = await this.collection(collectionId);
    return collection === undefined
      ? []
      : orderCards(collection, await this.#records.list("conversation-card"));
  }

  async card(
    collectionId: string,
    cardId: string,
  ): Promise<ConversationCard | undefined> {
    const card = await this.#records.get("conversation-card", cardId);
    const collection =
      card?.collectionId === collectionId
        ? await this.collection(collectionId)
        : undefined;
    return collection === undefined ? undefined : card;
  }

  async strays(): Promise<readonly ConversationCard[]> {
    const [collections, cards] = await Promise.all([
      this.#records.list("card-collection"),
      this.#records.list("conversation-card"),
    ]);
    const known = new Set(collections.map((each) => each.id));
    return cards
      .filter((card) => !known.has(card.collectionId))
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
  }

  subscribe(listener: () => void): () => void {
    return this.#records.subscribe(listener);
  }
}
