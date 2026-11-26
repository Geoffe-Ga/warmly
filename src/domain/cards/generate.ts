/**
 * Drafting cards with AI from entries the person picked (PRD CC-001 to
 * CC-004, CC-011, AI-009 to AI-012, DEP-001; AC-10, AC-15, AC-26).
 *
 * This module only prepares the request and stores what comes back. It
 * sends nothing: a request is sent by the gateway, after the person has
 * agreed to that very request in the disclosure dialog.
 *
 * The request holds exactly the entries the person ticked. None is added,
 * and none is dropped to make the request fit: if they are too much for
 * one request, the person is asked to pick fewer.
 */
import { contextBudget, type Budget } from "../../ai/budget";
import type { GeneratedCard } from "../../ai/contracts";
import type { CardsRequest, SourceEntry } from "../../ai/provider";
import type { RecordStore } from "../../storage/record-store";
import type { JournalEntry } from "../journal/types";
import type { ConversationCard } from "./types";

/**
 * What is needed to tell whether the picked entries fit in one request:
 * the limits, and a way to size a request without sending it. The gateway
 * gives one (`services.ai.sizing()`); this module never reaches the
 * gateway itself.
 */
export interface CardsSizing {
  readonly budget: Budget;
  readonly estimate: (request: CardsRequest) => number;
}

/** No entry was picked, so there is nothing to draft cards from. */
export class NothingSelectedError extends Error {
  constructor() {
    super("No journal entry was selected");
    this.name = "NothingSelectedError";
  }
}

/**
 * The picked entries do not fit in one request. Nothing is left out to
 * make them fit: the person picks fewer.
 */
export class SelectionTooLargeError extends Error {
  constructor() {
    super("The selected entries do not fit in one request");
    this.name = "SelectionTooLargeError";
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
 * Build the request for cards from the entries the person picked.
 *
 * @param selected - The picked entries. Only finished entries can be
 *   picked; a draft among them is refused with the rest.
 * @param sizing - The provider's limits and a way to size a request, or
 *   `undefined` when no provider is connected (the gateway refuses then).
 * @returns The request, holding these entries and no others, oldest first.
 * @throws NothingSelectedError if none was picked, or one is a draft.
 * @throws SelectionTooLargeError if they do not fit in one request.
 */
export function cardsRequest(
  selected: readonly JournalEntry[],
  sizing: CardsSizing | undefined,
): CardsRequest {
  if (
    selected.length === 0 ||
    selected.some((entry) => entry.status !== "complete")
  ) {
    throw new NothingSelectedError();
  }
  const inOrder = [...selected].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const empty: CardsRequest = { kind: "cards", topic: "", entries: [] };
  const request: CardsRequest = { ...empty, entries: inOrder.map(sourceOf) };
  if (sizing !== undefined) {
    const framing = sizing.estimate(empty);
    const needed = sizing.estimate(request) - framing;
    // A size that cannot be worked out is treated as too large: a request
    // of unknown size is never sent.
    if (!(needed <= contextBudget(sizing.budget, framing))) {
      throw new SelectionTooLargeError();
    }
  }
  return request;
}

/**
 * Turn checked AI cards into cards for a collection. Each is marked as
 * drafted by AI and records every entry that was sent for it, with its
 * hash then, so it can be removed if any of them changes (PRD DEP-001).
 *
 * The cards get their IDs here, once. Storing the same cards again later,
 * for example after a failure, stores the same records and adds nothing.
 *
 * @param generated - The cards the gateway checked.
 * @param request - The request they answer.
 * @param collectionId - The collection they are for.
 * @param now - The current time.
 * @returns The cards, not yet stored.
 */
export function cardsFrom(
  generated: readonly GeneratedCard[],
  request: CardsRequest,
  collectionId: string,
  now: Date = new Date(),
): ConversationCard[] {
  const at = now.toISOString();
  const sources = request.entries.map((entry) => ({
    entryId: entry.id,
    sourceHash: entry.contentHash,
  }));
  return generated.map((card) => ({
    id: crypto.randomUUID(),
    collectionId,
    type: card.type,
    authorship: "ai_generated",
    segments: card.segments,
    sourceEntryIds: card.sourceEntryIds,
    sources,
    theme: card.theme,
    createdAt: at,
    updatedAt: at,
  }));
}

/**
 * Store drafted cards and add them to the end of their collection.
 *
 * The cards are stored first and then added to the collection's list, so
 * a failure part way leaves cards that are still shown (see `orderCards`).
 * A card that is already stored is left as it is, so this can be run
 * again safely. If the collection is no longer here, for example because
 * it was deleted on another device meanwhile, the cards are stored all
 * the same and are offered on the collections screen: what the person
 * asked for and agreed to send is never thrown away.
 *
 * @param deps - The record store.
 * @param cards - Cards from {@link cardsFrom}, all for one collection.
 * @param now - The current time.
 * @returns Whether the collection was here to add them to.
 */
export async function saveGenerated(
  deps: { readonly records: RecordStore },
  cards: readonly ConversationCard[],
  now: Date = new Date(),
): Promise<boolean> {
  const [first] = cards;
  if (first === undefined) {
    return true;
  }
  for (const card of cards) {
    if ((await deps.records.get("conversation-card", card.id)) === undefined) {
      await deps.records.put("conversation-card", card);
    }
  }
  const collection = await deps.records.get(
    "card-collection",
    first.collectionId,
  );
  if (collection === undefined) {
    return false;
  }
  const missing = cards
    .map((card) => card.id)
    .filter((id) => !collection.cardIds.includes(id));
  if (missing.length > 0) {
    await deps.records.put("card-collection", {
      ...collection,
      cardIds: [...collection.cardIds, ...missing],
      updatedAt: now.toISOString(),
    });
  }
  return true;
}
