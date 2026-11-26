/**
 * Conversation cards and the collections that hold them (PRD CC-001,
 * CC-012, §7).
 *
 * A card is something the person may want to say, in their own words or
 * drafted by AI and then theirs to rewrite. Everything here is private
 * content. A card never holds text copied from a journal entry: where it
 * rests on the journal it holds references only (DEP-004).
 */
import {
  CARD_TYPES,
  EVIDENCE_KINDS,
  SEGMENT_CATEGORIES,
  type CardSegment as GeneratedSegment,
  type CardType,
  type SentSource,
} from "../../ai/contracts";

export type {
  CardType,
  EvidenceKind,
  SegmentCategory,
} from "../../ai/contracts";

/**
 * Who a card's wording belongs to.
 *
 * - `ai_generated`: drafted by AI and not yet changed by the person.
 * - `user_owned`: written by the person, or changed by them since.
 */
export type Authorship = "ai_generated" | "user_owned";

/**
 * One part of a card. A part the person wrote has an ID, a category and
 * text. A part drafted by AI also says what it rests on and why it is
 * worded that way; a checked AI answer's part fits this type as it is.
 */
export type CardSegment = Pick<GeneratedSegment, "id" | "category" | "text"> &
  Partial<
    Pick<GeneratedSegment, "evidence" | "evidenceKind" | "teachingExplanation">
  >;

/** One conversation card. */
export interface ConversationCard {
  /** An opaque random ID. */
  readonly id: string;
  /** The collection the card is in. */
  readonly collectionId: string;
  readonly type: CardType;
  readonly authorship: Authorship;
  /** The card's parts, in reading order. */
  readonly segments: readonly CardSegment[];
  /** Journal entries the card was drafted from. Empty for a manual card. */
  readonly sourceEntryIds: readonly string[];
  /**
   * Every entry that was sent to draft this card, quoted or not, with its
   * content hash at the time (PRD DEP-001). The card was written from all
   * of them, so a change to any of them makes it out of date. Absent for
   * a manual card. IDs and hashes only: never text from an entry.
   */
  readonly sources?: readonly SentSource[];
  /** The theme the AI gave a card it drafted, in a few words. */
  readonly theme?: string;
  /** When the card was made, as an ISO 8601 instant. */
  readonly createdAt: string;
  /** When it was last changed, as an ISO 8601 instant. */
  readonly updatedAt: string;
}

/** A named, private set of cards in an order the person chose. */
export interface CardCollection {
  /** An opaque random ID. */
  readonly id: string;
  /** The name the person gave it. Private: never in a URL or a title. */
  readonly name: string;
  /** The cards, in order. */
  readonly cardIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** How each kind of card is named on screen. */
export const CARD_TYPE_LABELS: Readonly<Record<CardType, string>> = {
  appreciation: "Appreciation",
  need_request: "Need and request",
  curiosity: "Curiosity",
  other: "Other",
};

/**
 * A card as it is read aloud: its parts in order, as plain sentences, with
 * nothing about where they came from (PRD CC-007).
 *
 * @param card - The card.
 * @returns The text to read.
 */
export function readingText(card: ConversationCard): string {
  return card.segments
    .map((segment) => segment.text.trim())
    .filter((text) => text !== "")
    .join(" ");
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isOneOf(value: unknown, options: readonly string[]): boolean {
  return isText(value) && options.includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isListOf<T>(
  value: unknown,
  item: (each: unknown) => each is T,
): value is T[] {
  return Array.isArray(value) && value.every(item);
}

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSourceRef(value: unknown): boolean {
  return (
    isObject(value) &&
    isText(value["entryId"]) &&
    isOneOf(value["responseKey"], ["good", "improve", "loved"]) &&
    isWhole(value["start"]) &&
    isWhole(value["end"]) &&
    isText(value["sourceHash"])
  );
}

function isSentSource(value: unknown): boolean {
  return (
    isObject(value) && isText(value["entryId"]) && isText(value["sourceHash"])
  );
}

function isSegment(value: unknown): value is CardSegment {
  return (
    isObject(value) &&
    isText(value["id"]) &&
    isOneOf(value["category"], SEGMENT_CATEGORIES) &&
    isText(value["text"]) &&
    (value["evidence"] === undefined ||
      (Array.isArray(value["evidence"]) &&
        value["evidence"].every(isSourceRef))) &&
    (value["evidenceKind"] === undefined ||
      isOneOf(value["evidenceKind"], EVIDENCE_KINDS)) &&
    (value["teachingExplanation"] === undefined ||
      isText(value["teachingExplanation"]))
  );
}

/**
 * Check that a value read back from storage has the shape of a card.
 *
 * @param value - What was decrypted.
 * @returns Whether it is a conversation card.
 */
export function isConversationCard(value: unknown): value is ConversationCard {
  return (
    isObject(value) &&
    isText(value["id"]) &&
    isText(value["collectionId"]) &&
    isOneOf(value["type"], CARD_TYPES) &&
    isOneOf(value["authorship"], ["ai_generated", "user_owned"]) &&
    isListOf(value["segments"], isSegment) &&
    isListOf(value["sourceEntryIds"], isText) &&
    (value["sources"] === undefined ||
      (Array.isArray(value["sources"]) &&
        value["sources"].every(isSentSource))) &&
    (value["theme"] === undefined || isText(value["theme"])) &&
    isText(value["createdAt"]) &&
    isText(value["updatedAt"])
  );
}

/**
 * Check that a value read back from storage has the shape of a collection.
 *
 * @param value - What was decrypted.
 * @returns Whether it is a card collection.
 */
export function isCardCollection(value: unknown): value is CardCollection {
  return (
    isObject(value) &&
    isText(value["id"]) &&
    isText(value["name"]) &&
    isListOf(value["cardIds"], isText) &&
    isText(value["createdAt"]) &&
    isText(value["updatedAt"])
  );
}

/**
 * Put a collection's cards in order.
 *
 * The cards the collection lists come first, in its order. A card that
 * belongs to the collection but is not in its list comes after them, oldest
 * first. That happens when two devices each add a card and one device's
 * version of the list is kept: neither card is lost, whichever list wins.
 * A listed card that does not exist, or belongs elsewhere, is left out.
 *
 * @param collection - The collection.
 * @param cards - Any cards; only this collection's are used.
 * @returns The collection's cards, in order.
 */
export function orderCards(
  collection: CardCollection,
  cards: readonly ConversationCard[],
): ConversationCard[] {
  const own = new Map(
    cards
      .filter((card) => card.collectionId === collection.id)
      .map((card) => [card.id, card]),
  );
  // A set, so a card named twice in the list is shown once.
  const listed = [...new Set(collection.cardIds)]
    .map((cardId) => own.get(cardId))
    .filter((card) => card !== undefined);
  const seen = new Set(listed.map((card) => card.id));
  const unlisted = [...own.values()]
    .filter((card) => !seen.has(card.id))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  return [...listed, ...unlisted];
}
