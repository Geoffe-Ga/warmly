/**
 * The grounding check: an AI answer is accepted only if everything it cites
 * was really sent, and really says what is quoted (PRD AI-012, SEC-010;
 * AC-07, AC-26; decision D-16, ADR-0008).
 *
 * An answer cites a name from the request (`E1`), one of the entry's three
 * answers, and a quote. For each citation this module:
 *
 * 1. looks the name up in the manifest of **this** request;
 * 2. checks the quote is, character for character, part of the text sent
 *    under that name;
 * 3. works out where, and attaches the real entry ID and content hash.
 *
 * The provider supplies none of the IDs, hashes or positions, so it cannot
 * get them wrong and cannot make them up. One citation that fails rejects
 * the whole answer. Nothing is repaired and nothing partial is returned.
 *
 * What this does not show is that a quote supports the claim it is attached
 * to. It shows the person wrote those words, in that entry. The person can
 * open the entry and judge the rest.
 */
import {
  parseAlternatives,
  parseCards,
  parseReflection,
  type CardSegment,
  type GeneratedCard,
  type ReflectionAnswer,
  type SegmentAlternatives,
  type SourceRef,
  type WireCard,
  type WireEvidence,
  type WireSegment,
} from "./contracts";
import { lookup, type Manifest } from "./manifest";
import type { RequestCoverage } from "./provider";

/** Why an answer's citation was not accepted. */
export type UngroundedReason =
  /** It cites a name this request did not send. */
  | "unknown_source"
  /** The quote is not in the text sent under that name. */
  | "quote_not_found"
  /** Something said to come from the journal quotes nothing. */
  | "evidence_missing";

/**
 * An answer cites something that was not sent, or quotes words that are not
 * there. Nothing of the answer is used. The error carries the reason only,
 * never the quote or any other text.
 */
export class UngroundedCitationError extends Error {
  readonly reason: UngroundedReason;

  /** @param reason - Why the citation was not accepted. */
  constructor(reason: UngroundedReason) {
    super(`The AI answer cites something it was not given (${reason})`);
    this.name = "UngroundedCitationError";
    this.reason = reason;
  }
}

/** Check one citation and turn it into a reference to a real entry. */
function resolve(cited: WireEvidence, manifest: Manifest): SourceRef {
  const source = lookup(manifest, cited.alias);
  if (source === undefined) {
    throw new UngroundedCitationError("unknown_source");
  }
  // Exact, with no tidying of spaces, case or punctuation: tidying is how a
  // near miss turns into words the person never wrote.
  const start = source.responses[cited.key].indexOf(cited.quote);
  if (start < 0) {
    throw new UngroundedCitationError("quote_not_found");
  }
  return {
    entryId: source.entryId,
    responseKey: cited.key,
    start,
    end: start + cited.quote.length,
    sourceHash: source.sourceHash,
  };
}

const NOTHING_OMITTED: RequestCoverage = {
  omittedEntryCount: 0,
  truncated: false,
};

/**
 * Check a Reflect answer against what was sent.
 *
 * @param raw - What the provider returned.
 * @param manifest - The manifest of the request that was sent.
 * @param coverage - What the request left out, to report with the answer.
 * @returns The answer, with every citation tied to a real entry.
 * @throws MalformedResponseError if the answer is not in the agreed form.
 * @throws UngroundedCitationError if any citation fails.
 */
export function groundReflection(
  raw: unknown,
  manifest: Manifest,
  coverage: RequestCoverage = NOTHING_OMITTED,
): ReflectionAnswer {
  const wire = parseReflection(raw);
  return {
    markdown: wire.markdown,
    citations: wire.citations.map((citation) => ({
      claimId: citation.claimId,
      evidence: citation.evidence.map((cited) => resolve(cited, manifest)),
    })),
    sources: manifest.sources.map((source) => ({
      entryId: source.entryId,
      sourceHash: source.sourceHash,
    })),
    coverage: {
      includedEntryIds: manifest.sources.map((source) => source.entryId),
      omittedEntryCount: coverage.omittedEntryCount,
      truncated: coverage.truncated,
    },
  };
}

function groundSegment(
  wire: WireSegment,
  manifest: Manifest,
  newId: () => string,
): CardSegment {
  const fromJournal =
    wire.evidenceKind === "explicit" || wire.evidenceKind === "paraphrase";
  if (fromJournal && wire.evidence.length === 0) {
    throw new UngroundedCitationError("evidence_missing");
  }
  return {
    id: newId(),
    category: wire.category,
    text: wire.text,
    // An inference may quote what it rests on. If it does, the quote is
    // checked like any other.
    evidence: wire.evidence.map((cited) => resolve(cited, manifest)),
    evidenceKind: wire.evidenceKind,
    teachingExplanation: wire.teachingExplanation,
  };
}

function groundCard(
  wire: WireCard,
  manifest: Manifest,
  newId: () => string,
): GeneratedCard {
  const segments = wire.segments.map((segment) =>
    groundSegment(segment, manifest, newId),
  );
  const quoted = new Set(
    segments.flatMap((segment) => segment.evidence.map((ref) => ref.entryId)),
  );
  // A card that quotes nothing was not made from the journal at all.
  if (quoted.size === 0) {
    throw new UngroundedCitationError("evidence_missing");
  }
  return {
    type: wire.type,
    theme: wire.theme,
    segments,
    // Walked in the order the entries were sent, so the list is in that
    // order and names each entry once.
    sourceEntryIds: manifest.sources
      .map((source) => source.entryId)
      .filter((entryId) => quoted.has(entryId)),
  };
}

/**
 * Check a cards answer against what was sent.
 *
 * @param raw - What the provider returned.
 * @param manifest - The manifest of the request that was sent.
 * @param newId - Makes the ID of each part of a card.
 * @returns One to three cards, each quoting at least one entry sent.
 * @throws MalformedResponseError if the answer is not in the agreed form.
 * @throws UngroundedCitationError if any citation fails, or a card or a
 *   part said to come from the journal quotes nothing.
 */
export function groundCards(
  raw: unknown,
  manifest: Manifest,
  newId: () => string = () => crypto.randomUUID(),
): readonly GeneratedCard[] {
  return parseCards(raw).map((card) => groundCard(card, manifest, newId));
}

/**
 * Check an answer offering other wordings. They cite nothing, so there is
 * only their form to check; they are the AI's suggestions and are shown as
 * such.
 *
 * @param raw - What the provider returned.
 * @returns The wordings.
 * @throws MalformedResponseError if the answer is not in the agreed form.
 */
export function groundAlternatives(raw: unknown): SegmentAlternatives {
  // Nothing to tie to the journal; kept beside the other two so every kind
  // of answer is checked through this module.
  return parseAlternatives(raw);
}
