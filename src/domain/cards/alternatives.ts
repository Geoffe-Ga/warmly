/**
 * Other ways to word one part of a card, asked of AI only when the person
 * presses the button for it (PRD CC-005, CC-006; AC-11, AC-15).
 *
 * This module prepares the request and applies the person's choice. It
 * sends nothing: a request is sent by the gateway, after the person has
 * agreed to that very request in the disclosure dialog.
 *
 * The wordings that come back are suggestions. They cite nothing
 * (ADR-0008), they are never stored unless the person picks one, and a
 * picked wording is marked as a suggestion, because nothing has checked
 * it against the journal.
 */
import type {
  SegmentAlternativesRequest,
  SourceEntry,
} from "../../ai/provider";
import type { RecordStore } from "../../storage/record-store";
import type { JournalEntry } from "../journal/types";
import type { ConversationCard } from "./types";

/** The part to reword is not in the card. */
export class SegmentNotFoundError extends Error {
  constructor() {
    super("The card has no such part");
    this.name = "SegmentNotFoundError";
  }
}

/** A fresh copy of what is sent of one entry: its ID, hash and answers. */
function sourceOf(entry: JournalEntry): SourceEntry {
  return {
    id: entry.id,
    contentHash: entry.contentHash,
    responses: {
      good: entry.responses.good,
      improve: entry.responses.improve,
      loved: entry.responses.loved,
    },
  };
}

/**
 * Build the request for other wordings of one part of a card.
 *
 * It holds the part's current words and the entries the card was drafted
 * from: those and no others, and only the ones that are still the text
 * the card was drafted from. An entry that is not on this device, or has
 * changed, is not sent in its place.
 *
 * @param card - The card.
 * @param segmentId - Which part to reword.
 * @param entries - The journal as it is now.
 * @returns The request, with the entries oldest first.
 * @throws SegmentNotFoundError if the card has no such part.
 */
export function alternativesRequest(
  card: ConversationCard,
  segmentId: string,
  entries: readonly JournalEntry[],
): SegmentAlternativesRequest {
  const segment = card.segments.find((each) => each.id === segmentId);
  if (segment === undefined) {
    throw new SegmentNotFoundError();
  }
  const sent = (card.sources ?? [])
    .map(({ entryId, sourceHash }) =>
      entries.find(
        (entry) =>
          entry.id === entryId &&
          entry.status === "complete" &&
          entry.contentHash === sourceHash,
      ),
    )
    .filter((entry) => entry !== undefined)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  return {
    kind: "segment-alternatives",
    text: segment.text,
    entries: sent.map(sourceOf),
  };
}

/**
 * Put a wording the person picked in place of one part of a card.
 *
 * Only that part changes. Its words become the picked wording, and what
 * was said about the old words goes with them: the quotes it rested on
 * and the explanation of why it was worded that way described text that
 * is no longer there. The part is marked as a suggestion, which is what a
 * wording from AI that cites nothing is. The other parts, and what the
 * card was drafted from, are left as they are.
 *
 * @param deps - The record store.
 * @param cardId - The card.
 * @param segmentId - The part to replace.
 * @param text - The wording the person picked.
 * @param now - The current time.
 * @returns The changed card, or `undefined` if the card or the part is no
 *   longer here.
 */
export async function chooseAlternative(
  deps: { readonly records: RecordStore },
  cardId: string,
  segmentId: string,
  text: string,
  now: Date = new Date(),
): Promise<ConversationCard | undefined> {
  const card = await deps.records.get("conversation-card", cardId);
  if (
    card === undefined ||
    !card.segments.some((segment) => segment.id === segmentId)
  ) {
    return undefined;
  }
  const changed: ConversationCard = {
    ...card,
    segments: card.segments.map((segment) =>
      segment.id === segmentId
        ? {
            id: segment.id,
            category: segment.category,
            text,
            evidenceKind: "suggestion",
            evidence: [],
          }
        : segment,
    ),
    updatedAt: now.toISOString(),
  };
  await deps.records.put("conversation-card", changed);
  return changed;
}
