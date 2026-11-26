/**
 * What a card drafted by AI was built from (PRD DEP-001, DEP-003;
 * invariant 6; ADR-0010).
 *
 * A card that is still as the AI drafted it depends on every entry that
 * was sent to draft it. When any of them is changed or deleted the card
 * is removed, because it may repeat words that are no longer in the
 * journal. A card the person wrote depends on nothing.
 */
import { ruleFor, type DerivedSource } from "../deps/index";
import type { ConversationCard } from "./types";

function sourcesOf(card: ConversationCard): DerivedSource[] {
  if (card.authorship !== "ai_generated") {
    return [];
  }
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

/** The rule for conversation cards. */
export const CARD_RULE = ruleFor("conversation-card", sourcesOf);
