/**
 * Choosing which journal entries go into one Reflect request (PRD RF-004,
 * AI-016; AC-09; decision D-18, ADR-0009).
 *
 * A long journal does not fit in one request. This picks what to send so
 * that the request fits its budget, the same inputs always give the same
 * choice, older history is still represented, and what was left out is
 * counted and said. It is a pure function: no clock, no randomness, no
 * network, no AI. An entry is sent whole or not at all.
 *
 * An entry that is larger than the whole budget is left out and counted,
 * because it could never be sent. Of the rest: when everything fits,
 * everything is sent. Otherwise the budget is spent in three parts:
 *
 * 1. 60% on the newest entries, working backwards from the latest;
 * 2. 20% on the entries whose words overlap most with the question;
 * 3. 20% on an evenly spaced sample of what is left, so that the older
 *    journal is not reduced to nothing.
 *
 * Whatever budget is still unspent then goes to the newest entries not yet
 * chosen. The result is given oldest first.
 */
import type { RequestCoverage } from "../../ai/provider";
import type { JournalEntry } from "../journal/types";
import { tokenize } from "../search/tokenize";

/** The share of the budget each part may spend. */
export const SHARES = { newest: 0.6, relevant: 0.2, spread: 0.2 } as const;

/**
 * There are entries, and every one of them is larger than the whole
 * budget, so there is nothing that can be sent. Nothing was sent.
 */
export class EntryTooLargeError extends Error {
  /** The oldest entry that does not fit. Only its ID: never its text. */
  readonly entryId: string;

  /** @param entryId - The entry that does not fit. */
  constructor(entryId: string) {
    super("A journal entry is too large to send in one request");
    this.name = "EntryTooLargeError";
    this.entryId = entryId;
  }
}

/** What was chosen, and what that leaves out. */
export interface Selection {
  /** The entries to send, oldest first. */
  readonly entries: readonly JournalEntry[];
  /** How many finished entries there were to choose from. */
  readonly total: number;
  /**
   * The entries left out because each is too long to send at all, by ID.
   * They are counted in `coverage.omittedEntryCount` as well.
   */
  readonly tooLong: readonly string[];
  readonly coverage: RequestCoverage & {
    readonly includedEntryIds: readonly string[];
  };
}

interface Sized {
  readonly entry: JournalEntry;
  readonly size: number;
  /** Position in the journal, oldest first. */
  readonly at: number;
}

/**
 * An entry's size in whole tokens: at least one. A size that is not a
 * number cannot be trusted, so such an entry counts as too long to send.
 */
function sizeOf(estimate: number): number {
  return Number.isFinite(estimate)
    ? Math.max(1, Math.ceil(estimate))
    : Number.POSITIVE_INFINITY;
}

function inOrder(entries: readonly JournalEntry[]): JournalEntry[] {
  return entries
    .filter((entry) => entry.status === "complete")
    .sort(
      (a, b) =>
        a.entryDate.date.localeCompare(b.entryDate.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

function wordsOf(text: string): Set<string> {
  return new Set(tokenize(text).map((token) => token.word));
}

/** How many of the question's words an entry uses. */
function overlap(question: ReadonlySet<string>, entry: JournalEntry): number {
  const words = wordsOf(
    `${entry.responses.good} ${entry.responses.improve} ${entry.responses.loved}`,
  );
  let shared = 0;
  for (const word of question) {
    if (words.has(word)) {
      shared += 1;
    }
  }
  return shared;
}

/** Keeps track of what has been chosen and how much budget is left. */
class Chosen {
  readonly #taken = new Set<number>();
  #left: number;

  constructor(budget: number) {
    this.#left = budget;
  }

  has(item: Sized): boolean {
    return this.#taken.has(item.at);
  }

  /**
   * Choose an entry if it fits in both the part's allowance and what is
   * left of the whole budget.
   *
   * @returns How much of the allowance is left afterwards.
   */
  take(item: Sized, allowance: number): number {
    if (this.has(item) || item.size > allowance || item.size > this.#left) {
      return allowance;
    }
    this.#taken.add(item.at);
    this.#left -= item.size;
    return allowance - item.size;
  }

  get left(): number {
    return this.#left;
  }

  /** The chosen entries, oldest first. */
  from(all: readonly Sized[]): Sized[] {
    return all.filter((item) => this.has(item));
  }
}

/** Part 1: the newest entries, stopping at the first that does not fit. */
function takeNewest(
  all: readonly Sized[],
  chosen: Chosen,
  share: number,
): void {
  let allowance = share;
  for (const item of [...all].reverse()) {
    const after = chosen.take(item, allowance);
    if (after === allowance && !chosen.has(item)) {
      return;
    }
    allowance = after;
  }
}

/** Part 2: entries that share words with the question, most first. */
function takeRelevant(
  all: readonly Sized[],
  chosen: Chosen,
  share: number,
  question: string,
): void {
  const asked = wordsOf(question);
  const scored = all
    .filter((item) => !chosen.has(item))
    .map((item) => ({ item, score: overlap(asked, item.entry) }))
    .filter((each) => each.score > 0)
    // Most shared words first, then the later place in the journal. No two
    // entries share a place, and the journal's order ends with the ID, so
    // a tie is settled the same way every time.
    .sort((a, b) => b.score - a.score || b.item.at - a.item.at);
  let allowance = share;
  for (const { item } of scored) {
    allowance = chosen.take(item, allowance);
  }
}

/** Part 3: an evenly spaced sample of what is left, oldest to newest. */
function takeSpread(
  all: readonly Sized[],
  chosen: Chosen,
  share: number,
): void {
  const rest = all.filter((item) => !chosen.has(item));
  if (rest.length === 0) {
    return;
  }
  const average = rest.reduce((sum, item) => sum + item.size, 0) / rest.length;
  const wanted = Math.min(
    rest.length,
    Math.max(1, Math.floor(share / average)),
  );
  let allowance = share;
  for (let pick = 0; pick < wanted; pick += 1) {
    // Evenly spaced positions, always including the very oldest.
    const index =
      wanted === 1 ? 0 : Math.round((pick * (rest.length - 1)) / (wanted - 1));
    const item = rest[index];
    if (item !== undefined) {
      allowance = chosen.take(item, allowance);
    }
  }
}

/** Last: spend what is left on the newest entries not yet chosen. */
function topUp(all: readonly Sized[], chosen: Chosen): void {
  for (const item of [...all].reverse()) {
    chosen.take(item, chosen.left);
  }
}

/**
 * Choose the entries for one request.
 *
 * @param input - The journal; the question; `estimate`, which gives the
 *   size of one entry in tokens and must give the same answer every time
 *   for the same entry; and `budget`, the tokens available for entries
 *   after everything else has been set aside (see `contextBudget`).
 * @returns The entries to send, oldest first, with what was left out. An
 *   entry larger than the whole budget can never be sent, so it is left
 *   out and named in `tooLong`; the rest are chosen as if it were not
 *   there. An entry whose size cannot be worked out is treated the same.
 * @throws EntryTooLargeError if there are entries and none of them fits.
 */
export function selectContext(input: {
  readonly entries: readonly JournalEntry[];
  readonly question: string;
  readonly estimate: (entry: JournalEntry) => number;
  readonly budget: number;
}): Selection {
  const budget = Math.max(0, Math.floor(input.budget));
  const all: Sized[] = inOrder(input.entries).map((entry, at) => ({
    entry,
    at,
    size: sizeOf(input.estimate(entry)),
  }));
  // An entry that could never be sent is set aside first, so that it
  // does not stop the others from being chosen.
  const sendable = all.filter((item) => item.size <= budget);
  const tooLong = all.filter((item) => item.size > budget);
  const [first] = tooLong;
  if (sendable.length === 0 && first !== undefined) {
    throw new EntryTooLargeError(first.entry.id);
  }

  const chosen = new Chosen(budget);
  const everything = sendable.reduce((sum, item) => sum + item.size, 0);
  if (everything <= budget) {
    topUp(sendable, chosen);
  } else {
    takeNewest(sendable, chosen, Math.floor(budget * SHARES.newest));
    takeRelevant(
      sendable,
      chosen,
      Math.floor(budget * SHARES.relevant),
      input.question,
    );
    takeSpread(sendable, chosen, Math.floor(budget * SHARES.spread));
    topUp(sendable, chosen);
  }

  const kept = chosen.from(sendable).map((item) => item.entry);
  const omitted = all.length - kept.length;
  return {
    entries: kept,
    total: all.length,
    tooLong: tooLong.map((item) => item.entry.id),
    coverage: {
      includedEntryIds: kept.map((entry) => entry.id),
      omittedEntryCount: omitted,
      truncated: omitted > 0,
    },
  };
}
