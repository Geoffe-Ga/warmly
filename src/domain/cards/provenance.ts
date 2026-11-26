/**
 * What a part of an AI-drafted card rests on, worked out on the device at
 * the moment it is shown (PRD CC-004, CC-005, DEP-004; AC-11, AC-26).
 *
 * A card holds references into the journal, never the journal's words.
 * The words are read here from the entry as it is now, and only if it is
 * still the text the card was drafted from. Otherwise nothing is shown:
 * stale words are never passed off as the source.
 */
import type { SourceRef } from "../../ai/contracts";
import type { EntryDate, JournalEntry } from "../journal/types";
import { PROMPTS } from "../journal/types";
import type { CardSegment } from "./types";

/** The person's own words that a part of a card rests on. */
export interface Excerpt {
  /** The entry the words are in. */
  readonly entryId: string;
  /** The day of that entry. */
  readonly entryDate: EntryDate;
  /** The question the words were written under. */
  readonly prompt: string;
  /** The words, exactly as they are in the entry now. */
  readonly text: string;
}

/**
 * How a part of a card stands in relation to the journal.
 *
 * - `quoted`: it rests on these words of the person's.
 * - `unresolved`: it was said to rest on the journal, but the words can no
 *   longer be shown (the entry is gone, changed, or not here yet).
 * - `inferred`: it is the AI's reading of what the person wrote.
 * - `suggested`: it is the AI's own addition.
 * - `own`: it has no annotation; the person wrote it.
 * - `loading`, `unknown`: the journal is not available to look in, which
 *   is not the same as the entry being gone, and is never said to be.
 */
export type Provenance =
  /** The journal is still being read, so nothing can be said yet. */
  | { readonly kind: "loading" }
  /** The journal could not be opened, so nothing can be said. */
  | { readonly kind: "unknown" }
  | { readonly kind: "quoted"; readonly excerpts: readonly Excerpt[] }
  | { readonly kind: "unresolved" }
  | { readonly kind: "inferred" }
  | { readonly kind: "suggested" }
  | { readonly kind: "own" };

/**
 * Drop half a character from either end of a piece of text.
 *
 * A range is counted in UTF-16 code units, so it can begin or end in the
 * middle of an emoji (ADR-0008). Half an emoji cannot be shown, so it is
 * left out: only the display changes, never the stored range.
 */
function wholeCharacters(text: string): string {
  const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;
  const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
  const from = text.length > 0 && isLow(text.charCodeAt(0)) ? 1 : 0;
  const last = text.charCodeAt(text.length - 1);
  const to = text.length > from && isHigh(last) ? text.length - 1 : text.length;
  return text.slice(from, to);
}

/**
 * Read the words a reference points to, if they can be trusted.
 *
 * @param ref - The reference a card holds.
 * @param entries - The journal as it is now.
 * @returns The words, or `undefined` if the entry is not here, is a
 *   draft, has changed since (its content hash differs), or the range
 *   does not lie inside the answer.
 */
export function excerptFor(
  ref: SourceRef,
  entries: readonly JournalEntry[],
): Excerpt | undefined {
  const entry = entries.find((each) => each.id === ref.entryId);
  const prompt = PROMPTS.find((each) => each.key === ref.responseKey);
  if (
    entry === undefined ||
    prompt === undefined ||
    entry.status !== "complete" ||
    entry.contentHash !== ref.sourceHash
  ) {
    return undefined;
  }
  const answer = entry.responses[prompt.key];
  if (!(ref.start >= 0 && ref.start < ref.end && ref.end <= answer.length)) {
    return undefined;
  }
  const text = wholeCharacters(answer.slice(ref.start, ref.end));
  if (text === "") {
    return undefined;
  }
  return {
    entryId: entry.id,
    entryDate: entry.entryDate,
    prompt: prompt.label,
    text,
  };
}

/**
 * Work out what one part of a card rests on.
 *
 * An inference or a suggestion is always labelled as that, even where the
 * AI quoted something beside it: what the person reads first is that the
 * wording is not their own. A part said to come from the journal shows
 * the words it can still resolve, and says so plainly when it can resolve
 * none.
 *
 * @param segment - The part of the card.
 * @param entries - The journal as it is now.
 * @returns Its provenance.
 */
export function provenanceOf(
  segment: CardSegment,
  entries: readonly JournalEntry[],
): Provenance {
  const kind = segment.evidenceKind;
  if (kind === undefined) {
    return { kind: "own" };
  }
  if (kind === "inference") {
    return { kind: "inferred" };
  }
  if (kind === "suggestion") {
    return { kind: "suggested" };
  }
  const excerpts = (segment.evidence ?? [])
    .map((ref) => excerptFor(ref, entries))
    .filter((excerpt) => excerpt !== undefined);
  return excerpts.length === 0
    ? { kind: "unresolved" }
    : { kind: "quoted", excerpts };
}
