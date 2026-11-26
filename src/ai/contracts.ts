/**
 * The shape of every AI answer the app accepts (PRD AI-007 to AI-011,
 * SEC-010; ADR-0008).
 *
 * There are two layers:
 *
 * - **Wire types** are what a provider is asked to return. They cite an
 *   entry by its name in the request (`E1`) and quote its text.
 * - **App types** are what the rest of the app uses. They carry real entry
 *   IDs, hashes and character ranges, all worked out by the app itself in
 *   `grounding.ts`. A provider never supplies any of those.
 *
 * The parsers here check form only: the right fields, of the right kind,
 * within fixed limits, and nothing else. A field the app did not ask for
 * makes the whole answer invalid. An answer is all or nothing: nothing in
 * this module repairs, trims or partly accepts one.
 *
 * Every text field is plain text to this module. It is never treated as
 * HTML, and whatever shows it must show it as text.
 */
import type { RequestCoverage, ResponseKey } from "./provider";

/** The provider's answer is not in the agreed form. Nothing of it is used. */
export class MalformedResponseError extends Error {
  /**
   * Where the answer went wrong, as field names and positions only, for
   * example `cards[1].segments[0].category`. Never any of the answer's text.
   */
  readonly path: string;

  /** @param path - Where the answer went wrong. */
  constructor(path: string) {
    super(`The AI answer is not in the agreed form at ${path}`);
    this.name = "MalformedResponseError";
    this.path = path;
  }
}

/** The kinds of thing one part of a card can be. */
export const SEGMENT_CATEGORIES = [
  "observation",
  "feeling",
  "need",
  "request",
  "appreciation",
  "curiosity",
  "other",
] as const;
/** One of {@link SEGMENT_CATEGORIES}. */
export type SegmentCategory = (typeof SEGMENT_CATEGORIES)[number];

/**
 * How a piece of text rests on the journal.
 *
 * - `explicit`: the person wrote this.
 * - `paraphrase`: a rewording of what the person wrote.
 * - `inference`: the AI's reading of it, which may be wrong.
 * - `suggestion`: the AI's own idea, resting on nothing in particular.
 *
 * The first two must quote the journal. The last two need not, and must be
 * shown as the AI's own.
 */
export const EVIDENCE_KINDS = [
  "explicit",
  "paraphrase",
  "inference",
  "suggestion",
] as const;
/** One of {@link EVIDENCE_KINDS}. */
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** The kinds of card. */
export const CARD_TYPES = [
  "appreciation",
  "need_request",
  "curiosity",
  "other",
] as const;
/** One of {@link CARD_TYPES}. */
export type CardType = (typeof CARD_TYPES)[number];

const RESPONSE_KEYS = [
  "good",
  "improve",
  "loved",
  "went_well",
  "difficult",
  "remember",
] as const;

/** The fixed limits an answer must fit. One over any of them is invalid. */
export const LIMITS = {
  /** Cards in one answer (AC-10). */
  cards: 3,
  /** Parts in one card. */
  segments: 8,
  /** Quotes behind one claim or one part of a card. */
  evidence: 5,
  /** Cited claims in one Reflect answer. */
  citations: 40,
  /** Other wordings in one answer. */
  alternatives: 3,
  /** Characters in a Reflect answer. */
  markdown: 12_000,
  /** Characters in one quote. */
  quote: 1_000,
  /** Characters in a part of a card, an explanation or another wording. */
  text: 600,
  /** Characters in a card's theme. */
  theme: 120,
  /** Characters in a source's name, such as `E12`. Longer is not a name. */
  alias: 8,
} as const;

// ---------------------------------------------------------------- wire types

/** A citation as a provider gives it: a name, which answer, and a quote. */
export interface WireEvidence {
  readonly alias: string;
  readonly key: ResponseKey;
  /** Text copied exactly from that answer of that entry. */
  readonly quote: string;
}

/** A Reflect answer as a provider gives it. */
export interface WireReflection {
  /** The answer. A cited claim is marked in it as `[c1]`, `[c2]`... */
  readonly markdown: string;
  readonly citations: readonly {
    readonly claimId: string;
    readonly evidence: readonly WireEvidence[];
  }[];
}

/** One part of a card as a provider gives it. */
export interface WireSegment {
  readonly category: SegmentCategory;
  readonly text: string;
  readonly evidenceKind: EvidenceKind;
  readonly teachingExplanation: string;
  readonly evidence: readonly WireEvidence[];
}

/** A card as a provider gives it. */
export interface WireCard {
  readonly type: CardType;
  readonly theme: string;
  readonly segments: readonly WireSegment[];
}

// ----------------------------------------------------------------- app types

/** Where in the journal a piece of text comes from. Made by the app only. */
export interface SourceRef {
  readonly entryId: string;
  readonly responseKey: ResponseKey;
  /** Where the quoted text starts in that answer, in UTF-16 code units. */
  readonly start: number;
  /** Where it ends (exclusive). */
  readonly end: number;
  /** The entry's content hash when it was sent. */
  readonly sourceHash: string;
}

/** One part of a card. */
export interface CardSegment {
  readonly id: string;
  readonly category: SegmentCategory;
  readonly text: string;
  readonly evidence: readonly SourceRef[];
  readonly evidenceKind: EvidenceKind;
  readonly teachingExplanation: string;
}

/** A card drafted by AI, checked and not yet saved. */
export interface GeneratedCard {
  readonly type: CardType;
  readonly theme: string;
  readonly segments: readonly CardSegment[];
  /** The entries this card quotes, in the order they were sent. */
  readonly sourceEntryIds: readonly string[];
}

/** One entry an answer was built from: which entry, and its hash then. */
export interface SentSource {
  readonly entryId: string;
  /** The entry's content hash when it was sent. */
  readonly sourceHash: string;
}

/** A checked answer to a Reflect question. */
export interface ReflectionAnswer {
  readonly markdown: string;
  readonly citations: readonly {
    readonly claimId: string;
    readonly evidence: readonly SourceRef[];
  }[];
  /**
   * Every entry that was sent to get this answer, cited or not, with its
   * content hash at the time (PRD DEP-002). An answer rests on all of
   * them, so this is what says later whether any has been changed or
   * deleted since. Worked out by the app from the request, never taken
   * from the provider.
   */
  readonly sources: readonly SentSource[];
  readonly coverage: RequestCoverage & {
    readonly includedEntryIds: readonly string[];
  };
}

/** Checked other wordings for one part of a card. */
export interface SegmentAlternatives {
  /** The AI's suggestions. They rest on nothing and must be shown as such. */
  readonly alternatives: readonly string[];
}

// ------------------------------------------------------------------- parsing

function fields(
  value: unknown,
  path: string,
  names: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MalformedResponseError(path);
  }
  const found = Object.keys(value);
  // Exactly the fields asked for. Anything more is not ours to interpret.
  if (
    found.length !== names.length ||
    !names.every((name) => Object.hasOwn(value, name))
  ) {
    throw new MalformedResponseError(path);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, limit: number): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > limit
  ) {
    throw new MalformedResponseError(path);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  options: readonly T[],
): T {
  const match = options.find((option) => option === value);
  if (match === undefined) {
    throw new MalformedResponseError(path);
  }
  return match;
}

function list<T>(
  value: unknown,
  path: string,
  range: { readonly min: number; readonly max: number },
  item: (value: unknown, path: string) => T,
): T[] {
  if (
    !Array.isArray(value) ||
    value.length < range.min ||
    value.length > range.max
  ) {
    throw new MalformedResponseError(path);
  }
  return value.map((each, index) => item(each, `${path}[${String(index)}]`));
}

function evidence(value: unknown, path: string): WireEvidence {
  const raw = fields(value, path, ["alias", "key", "quote"]);
  return {
    alias: text(raw["alias"], `${path}.alias`, LIMITS.alias),
    key: oneOf(raw["key"], `${path}.key`, RESPONSE_KEYS),
    quote: text(raw["quote"], `${path}.quote`, LIMITS.quote),
  };
}

function evidenceList(value: unknown, path: string, min: number) {
  return list(value, path, { min, max: LIMITS.evidence }, evidence);
}

const CLAIM_ID = /^c[1-9]\d?$/;
const CLAIM_MARKER = /\[(c[1-9]\d?)\]/g;

function claim(value: unknown, path: string) {
  const raw = fields(value, path, ["claimId", "evidence"]);
  const claimId = text(raw["claimId"], `${path}.claimId`, 3);
  if (!CLAIM_ID.test(claimId)) {
    throw new MalformedResponseError(`${path}.claimId`);
  }
  return {
    claimId,
    evidence: evidenceList(raw["evidence"], `${path}.evidence`, 1),
  };
}

/**
 * Check the form of a Reflect answer.
 *
 * Besides the fields, every cited claim must be marked in the text as
 * `[c1]`, and every such mark must have a citation: a claim cannot point at
 * evidence that is not there, and evidence cannot be attached to nothing.
 *
 * @param raw - What the provider returned.
 * @returns The answer, in wire form. Its citations are not yet checked
 *   against what was sent.
 * @throws MalformedResponseError if anything is off.
 */
export function parseReflection(raw: unknown): WireReflection {
  const top = fields(raw, "answer", ["markdown", "citations"]);
  const markdown = text(top["markdown"], "markdown", LIMITS.markdown);
  const citations = list(
    top["citations"],
    "citations",
    { min: 0, max: LIMITS.citations },
    claim,
  );
  const cited = citations.map((citation) => citation.claimId);
  const marked = new Set(
    [...markdown.matchAll(CLAIM_MARKER)].map((match) => match[1]),
  );
  if (
    new Set(cited).size !== cited.length ||
    marked.size !== cited.length ||
    !cited.every((claimId) => marked.has(claimId))
  ) {
    throw new MalformedResponseError("citations");
  }
  return { markdown, citations };
}

function segment(value: unknown, path: string): WireSegment {
  const raw = fields(value, path, [
    "category",
    "text",
    "evidenceKind",
    "teachingExplanation",
    "evidence",
  ]);
  return {
    category: oneOf(raw["category"], `${path}.category`, SEGMENT_CATEGORIES),
    text: text(raw["text"], `${path}.text`, LIMITS.text),
    evidenceKind: oneOf(
      raw["evidenceKind"],
      `${path}.evidenceKind`,
      EVIDENCE_KINDS,
    ),
    teachingExplanation: text(
      raw["teachingExplanation"],
      `${path}.teachingExplanation`,
      LIMITS.text,
    ),
    evidence: evidenceList(raw["evidence"], `${path}.evidence`, 0),
  };
}

function card(value: unknown, path: string): WireCard {
  const raw = fields(value, path, ["type", "theme", "segments"]);
  return {
    type: oneOf(raw["type"], `${path}.type`, CARD_TYPES),
    theme: text(raw["theme"], `${path}.theme`, LIMITS.theme),
    segments: list(
      raw["segments"],
      `${path}.segments`,
      { min: 1, max: LIMITS.segments },
      segment,
    ),
  };
}

/**
 * Check the form of a cards answer: one to three cards (AC-10), each with
 * at least one part.
 *
 * @param raw - What the provider returned.
 * @returns The cards, in wire form. Their citations are not yet checked.
 * @throws MalformedResponseError if anything is off.
 */
export function parseCards(raw: unknown): readonly WireCard[] {
  const top = fields(raw, "answer", ["cards"]);
  return list(top["cards"], "cards", { min: 1, max: LIMITS.cards }, card);
}

/**
 * Check the form of an answer offering other wordings: one to three.
 *
 * @param raw - What the provider returned.
 * @returns The wordings.
 * @throws MalformedResponseError if anything is off.
 */
export function parseAlternatives(raw: unknown): SegmentAlternatives {
  const top = fields(raw, "answer", ["alternatives"]);
  return {
    alternatives: list(
      top["alternatives"],
      "alternatives",
      { min: 1, max: LIMITS.alternatives },
      (value, path) => text(value, path, LIMITS.text),
    ),
  };
}
