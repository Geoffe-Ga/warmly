/**
 * Whose words a card holds (PRD CC-007 to CC-009, DEP-003, DEP-004;
 * AC-12; decision D-15).
 *
 * A card drafted by AI is the AI's until the person saves any change to
 * it. From then on it is theirs, for good: it is never deleted because a
 * journal entry changed, and nothing turns it back. The part they changed
 * loses what the AI said about it at once, because that described words
 * that are no longer there. Parts they did not touch keep theirs until a
 * source entry changes, when all of it goes.
 *
 * Nothing here reads, scores or corrects what the person writes, and
 * nothing calls AI.
 */
import type { RecordStore } from "../../storage/record-store";
import {
  InvalidCardTextError,
  cleanCardText,
  refuseIfChanged,
  type CardEditOptions,
} from "./cards";
import type { CardSegment, CardType, ConversationCard } from "./types";

/** One part as the person left it in the form. */
export interface PartDraft {
  /** The part's ID. */
  readonly id: string;
  /** Its words now. Empty, or only spaces, removes the part. */
  readonly text: string;
}

/** What the person saved: the card's kind and the words of its parts. */
export interface PartsDraft {
  readonly type: CardType;
  readonly parts: readonly PartDraft[];
}

/**
 * Whether a part still carries anything the AI said about it.
 *
 * @param segment - One part of a card.
 * @returns Whether it has quotes, a kind of evidence or an explanation.
 */
export function hasNotes(segment: CardSegment): boolean {
  return (
    segment.evidence !== undefined ||
    segment.evidenceKind !== undefined ||
    segment.teachingExplanation !== undefined
  );
}

/**
 * Whether any part of a card still carries something the AI said.
 *
 * @param card - The card.
 * @returns Whether learning mode has anything to show for it.
 */
export function hasAiNotes(card: ConversationCard): boolean {
  return card.segments.some(hasNotes);
}

/** A part with its words and nothing the AI said about them. */
function plain(segment: CardSegment, text: string = segment.text): CardSegment {
  return { id: segment.id, category: segment.category, text };
}

/**
 * Make a card the person's own, with these parts, and keep only the
 * references its remaining AI notes still need (PRD DEP-004).
 *
 * While some part still has notes, the card keeps the list of entries it
 * was drafted from, so those notes can be removed when one changes. Once
 * no part has any, every reference goes: the IDs, the hashes and the
 * theme the AI gave it.
 *
 * @param card - The card as it was.
 * @param type - Its kind now.
 * @param segments - Its parts now.
 * @param at - When, as an ISO 8601 instant.
 * @returns The card, not yet stored.
 */
export function owned(
  card: ConversationCard,
  type: CardType,
  segments: readonly CardSegment[],
  at: string,
): ConversationCard {
  const base = {
    id: card.id,
    collectionId: card.collectionId,
    type,
    authorship: "user_owned" as const,
    segments,
    createdAt: card.createdAt,
    updatedAt: at,
  };
  if (!segments.some(hasNotes)) {
    return { ...base, sourceEntryIds: [] };
  }
  const quoted = new Set(
    segments.flatMap((segment) =>
      (segment.evidence ?? []).map((ref) => ref.entryId),
    ),
  );
  return {
    ...base,
    sourceEntryIds: card.sourceEntryIds.filter((id) => quoted.has(id)),
    ...(card.sources === undefined ? {} : { sources: card.sources }),
    ...(card.theme === undefined ? {} : { theme: card.theme }),
  };
}

/**
 * A card with every word kept and everything the AI said about it gone:
 * no quotes, no kinds of evidence, no explanations, and no reference to
 * any journal entry.
 *
 * @param card - The card.
 * @param at - When, as an ISO 8601 instant.
 * @returns The card, not yet stored.
 */
export function withoutAiNotes(
  card: ConversationCard,
  at: string,
): ConversationCard {
  return owned(
    card,
    card.type,
    card.segments.map((segment) => plain(segment)),
    at,
  );
}

function cleanParts(
  card: ConversationCard,
  parts: readonly PartDraft[],
): CardSegment[] {
  const typed = new Map(parts.map((part) => [part.id, part.text]));
  const kept: CardSegment[] = [];
  for (const segment of card.segments) {
    const text = typed.get(segment.id);
    if (text === undefined || text === segment.text) {
      // Not in the form, or left exactly as it was: nothing changes.
      kept.push(segment);
    } else if (text.trim() !== "") {
      kept.push(plain(segment, cleanCardText(text)));
    }
  }
  if (kept.length === 0) {
    throw new InvalidCardTextError();
  }
  return kept;
}

/**
 * Save the person's changes to the parts of a card.
 *
 * Any change makes the card theirs (decision D-15): a part reworded, a
 * part emptied and so removed, or a different kind of card. A part whose
 * words changed keeps its place and its category and loses what the AI
 * said about it. A part left exactly as it was keeps everything. If
 * nothing at all changed, nothing is stored and the card is whose it was.
 *
 * The words are stored as typed, apart from spaces at the ends. Nothing
 * checks, scores or corrects them.
 *
 * @param deps - The record store.
 * @param cardId - The card.
 * @param draft - Its kind and the words of its parts.
 * @param options - The current time, and the card as the person was
 *   shown it.
 * @returns The card as it now is, or `undefined` if it is not here.
 * @throws InvalidCardTextError if no part has any words left, or a part
 *   is too long.
 * @throws StaleRecordError if `options.seen` is given and the card is no
 *   longer that. Nothing is stored.
 */
export async function rewriteParts(
  deps: { readonly records: RecordStore },
  cardId: string,
  draft: PartsDraft,
  options: CardEditOptions = {},
): Promise<ConversationCard | undefined> {
  const card = await deps.records.get("conversation-card", cardId);
  if (card === undefined) {
    return undefined;
  }
  refuseIfChanged(card, options.seen);
  const segments = cleanParts(card, draft.parts);
  const same =
    draft.type === card.type &&
    segments.length === card.segments.length &&
    segments.every((segment, index) => segment === card.segments[index]);
  if (same) {
    return card;
  }
  const changed = owned(
    card,
    draft.type,
    segments,
    (options.now ?? new Date()).toISOString(),
  );
  await deps.records.put("conversation-card", changed, card);
  return changed;
}
