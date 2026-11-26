/**
 * What a card that AI drafted was built from, and what happens to it when
 * that changes (PRD DEP-001, DEP-003, DEP-004; invariant 6; ADR-0010).
 *
 * - A card that is still as the AI drafted it depends on every entry that
 *   was sent to draft it. When any of them is changed or deleted the card
 *   is deleted, because it may repeat words that are no longer in the
 *   journal.
 * - A card the person has made their own is never deleted for this. While
 *   it still carries anything the AI said about its parts, it depends on
 *   the same entries, and when one changes every such note is taken out:
 *   the quotes, the kinds of evidence, the explanations and every
 *   reference to the journal. Its words stay exactly as they are.
 * - A card with nothing from AI in it depends on nothing.
 */
import type { RecordStore } from "../../storage/record-store";
import type { Dependent, DependencyRule, DerivedSource } from "../deps/index";
import { hasAiNotes, withoutAiNotes } from "./ownership";
import type { ConversationCard } from "./types";

function sourcesOf(card: ConversationCard): DerivedSource[] {
  const sources: DerivedSource[] = (card.sources ?? []).map(
    ({ entryId, sourceHash }) => ({ entryId, sourceHash }),
  );
  // Each quote names an entry and its hash as well. They are read too, so
  // a card is never kept on the strength of a list shorter than its own
  // quotes.
  for (const segment of card.segments) {
    for (const { entryId, sourceHash } of segment.evidence ?? []) {
      sources.push({ entryId, sourceHash });
    }
  }
  return sources;
}

/** Take the AI's notes out of a card the person owns, if it is still here. */
async function strip(records: RecordStore, cardId: string): Promise<void> {
  const card = await records.get("conversation-card", cardId);
  if (card?.authorship === "user_owned" && hasAiNotes(card)) {
    await records.put(
      "conversation-card",
      withoutAiNotes(card, new Date().toISOString()),
    );
  }
}

function dependentOf(card: ConversationCard): Dependent {
  const base = { kind: "conversation-card" as const, id: card.id };
  if (card.authorship === "ai_generated") {
    return { ...base, sources: sourcesOf(card), action: "delete" };
  }
  if (!hasAiNotes(card)) {
    return { ...base, sources: [], action: "strip" };
  }
  return {
    ...base,
    sources: sourcesOf(card),
    action: "strip",
    strip: (records) => strip(records, card.id),
  };
}

/** The rule for conversation cards. */
export const CARD_RULE: DependencyRule = {
  kind: "conversation-card",
  dependents: async (records) =>
    (await records.list("conversation-card")).map(dependentOf),
};
