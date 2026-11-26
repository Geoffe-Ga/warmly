/**
 * Building the request for a Reflect question (PRD RF-003, RF-004).
 *
 * The request is made of fresh copies: the entry's ID, its content hash and
 * its three answers, and nothing else about it. The gateway seals a
 * request once it has been shown, and sealing a stored record would freeze
 * something the rest of the app still uses.
 *
 * When the journal is too long for one request, `selectContext` chooses
 * which entries go (ADR-0009), and the request says how many were left
 * out, so the person is told before they agree and again beside the
 * answer. Nothing is cut down quietly.
 */
import { contextBudget, type Budget } from "../../ai/budget";
import type { ReflectRequest, SourceEntry } from "../../ai/provider";
import type { JournalEntry } from "../journal/types";
import { selectContext } from "./context";

/**
 * The limits on a request and a way to size one, from the gateway
 * (`AiGateway.sizing`). Sizing sends nothing.
 */
export interface RequestSizing {
  readonly budget: Budget;
  readonly estimate: (request: ReflectRequest) => number;
}

/** The longest a question may be, in characters. */
export const MAX_QUESTION = 2000;

/** A question was empty or too long. Nothing was sent. */
export class InvalidQuestionError extends Error {
  constructor() {
    super("A question needs some text, up to 2000 characters");
    this.name = "InvalidQuestionError";
  }
}

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
 * Make the request for a question.
 *
 * The entries that fit are chosen by `selectContext`. The room for them
 * is what is left of the budget after the question and the request's own
 * framing (the size of the same request with no entries), the app's
 * instructions, the answer and a margin (`contextBudget`). Each entry's
 * size is what it adds to that empty request, plus one token, because
 * rounding can hide up to one.
 *
 * @param question - The person's own question.
 * @param entries - The journal. Drafts are left out: an unfinished entry
 *   is not sent.
 * @param sizing - The limits and a way to size a request. Without it (no
 *   provider is connected, so nothing can be sent anyway) every finished
 *   entry is included.
 * @returns The request, oldest entry first, saying what was left out if
 *   anything was.
 * @throws InvalidQuestionError if the question is empty or too long.
 * @throws EntryTooLargeError if there are entries and none of them fits.
 */
export function reflectRequest(
  question: string,
  entries: readonly JournalEntry[],
  sizing?: RequestSizing,
): ReflectRequest {
  const asked = question.trim();
  if (asked === "" || [...asked].length > MAX_QUESTION) {
    throw new InvalidQuestionError();
  }
  const empty: ReflectRequest = {
    kind: "reflect",
    question: asked,
    entries: [],
  };
  const framing = sizing?.estimate(empty) ?? 0;
  const selection = selectContext({
    entries,
    question: asked,
    budget:
      sizing === undefined
        ? Number.POSITIVE_INFINITY
        : contextBudget(sizing.budget, framing),
    estimate: (entry) =>
      sizing === undefined
        ? 1
        : sizing.estimate({ ...empty, entries: [sourceOf(entry)] }) -
          framing +
          1,
  });
  return {
    kind: "reflect",
    question: asked,
    entries: selection.entries.map(sourceOf),
    ...(selection.coverage.truncated
      ? {
          coverage: {
            omittedEntryCount: selection.coverage.omittedEntryCount,
            truncated: true,
            ...(selection.tooLong.length > 0
              ? { tooLong: selection.tooLong.length }
              : {}),
          },
        }
      : {}),
  };
}
