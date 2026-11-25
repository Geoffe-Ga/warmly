/**
 * Conversation cards and the collections that hold them (PRD CC-001,
 * CC-012, §7).
 *
 * A card is something the person may want to say, in their own words or
 * drafted by AI and then theirs to rewrite. Everything here is private
 * content. A card never holds text copied from a journal entry: where it
 * rests on the journal it holds references only (DEP-004).
 */
import type {
  CardSegment as GeneratedSegment,
  CardType,
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
