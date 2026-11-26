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
import type {
  EarlierTurn,
  ReflectRequest,
  SourceEntry,
} from "../../ai/provider";
import type { JournalEntry } from "../journal/types";
import {
  isAfterNote,
  type PostConversationReflection,
} from "../post-conversation/types";
import { EntryTooLargeError, selectContext, type Selection } from "./context";

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

/**
 * The session's earlier turns leave no room for any journal entry, so a
 * new question cannot be asked in it. Nothing was sent.
 */
export class SessionTooLongError extends Error {
  constructor() {
    super("The reflection is too long to send with another question");
    this.name = "SessionTooLongError";
  }
}

/**
 * Choose the entries for a follow-up, and say truly why none fits.
 *
 * With earlier turns in the request there is less room. If no entry fits
 * in what is left, but one would fit a first question, the reflection is
 * what is too long, not the entry.
 *
 * @param select - Chooses the entries for the follow-up.
 * @param asFirstQuestion - Builds the same request with no earlier turns;
 *   it throws if no entry fits even then.
 * @returns What `select` chose.
 * @throws SessionTooLongError if only the earlier turns stop every entry.
 * @throws EntryTooLargeError if no entry would fit a first question either.
 */
function blamingTheSession<T>(select: () => T, asFirstQuestion: () => void): T {
  try {
    return select();
  } catch (error) {
    if (!(error instanceof EntryTooLargeError)) {
      throw error;
    }
    try {
      asFirstQuestion();
    } catch {
      // No entry fits a first question either: the entry is the cause.
      throw error;
    }
    throw new SessionTooLongError();
  }
}

/** Something that can be sent: an entry, or a later reflection. */
export type Sendable = JournalEntry | PostConversationReflection;

/**
 * A fresh copy of what is sent of one piece of writing: its ID, its hash
 * and its answers, under the names of its own kind. Something written
 * after a conversation is labelled as that, so it can never be read as an
 * answer to the journal's questions (PRD PC-004).
 */
function sourceOf(written: Sendable): SourceEntry {
  if (!isAfterNote(written)) {
    return {
      id: written.id,
      contentHash: written.contentHash,
      responses: {
        good: written.responses.good,
        improve: written.responses.improve,
        loved: written.responses.loved,
      },
    };
  }
  return {
    id: written.id,
    contentHash: written.contentHash,
    kind: "post_conversation",
    responses: {
      went_well: written.responses.went_well,
      difficult: written.responses.difficult,
      remember: written.responses.remember,
    },
  };
}

/**
 * Make the request for a question.
 *
 * The entries that fit are chosen by `selectContext`. The room for them
 * is what is left of the budget after the question, the session's earlier
 * turns and the request's own framing (the size of the same request with
 * no entries), the app's instructions, the answer and a margin
 * (`contextBudget`). Each entry's size is what it adds to that empty
 * request, plus one token, because rounding can hide up to one.
 *
 * @param question - The person's own question.
 * @param entries - The journal. Drafts are left out: an unfinished entry
 *   is not sent.
 * @param sizing - The limits and a way to size a request. Without it (no
 *   provider is connected, so nothing can be sent anyway) every finished
 *   entry is included.
 * @param history - The earlier turns of the session the question is asked
 *   in, and of no other. They are sent with it, as fresh copies.
 * @param after - The reflections written after conversations. They are
 *   chosen among with the entries, by the same rule, and sent labelled as
 *   their own kind.
 * @returns The request, oldest entry first, saying what was left out if
 *   anything was.
 * @throws InvalidQuestionError if the question is empty or too long.
 * @throws SessionTooLongError if the earlier turns leave no room at all.
 * @throws EntryTooLargeError if there are entries and none of them fits.
 */
export function reflectRequest(
  question: string,
  entries: readonly JournalEntry[],
  sizing?: RequestSizing,
  history: readonly EarlierTurn[] = [],
  after: readonly PostConversationReflection[] = [],
): ReflectRequest {
  const asked = question.trim();
  if (asked === "" || [...asked].length > MAX_QUESTION) {
    throw new InvalidQuestionError();
  }
  const empty: ReflectRequest = {
    kind: "reflect",
    question: asked,
    entries: [],
    ...(history.length > 0
      ? {
          history: history.map((turn) => ({
            question: turn.question,
            answer: turn.answer,
          })),
        }
      : {}),
  };
  const framing = sizing?.estimate(empty) ?? 0;
  const room =
    sizing === undefined
      ? Number.POSITIVE_INFINITY
      : contextBudget(sizing.budget, framing);
  if (room <= 0 && history.length > 0) {
    throw new SessionTooLongError();
  }
  const select = (): Selection<Sendable> =>
    selectContext<Sendable>({
      entries: [...entries, ...after],
      question: asked,
      budget: room,
      estimate: (entry) =>
        sizing === undefined
          ? 1
          : sizing.estimate({ ...empty, entries: [sourceOf(entry)] }) -
            framing +
            1,
    });
  const selection =
    history.length === 0
      ? select()
      : blamingTheSession(select, () => {
          reflectRequest(question, entries, sizing, [], after);
        });
  // Counted from what was really left out, not worked out by subtraction.
  const sent = new Set(selection.entries.map((each) => each.id));
  const afterOmitted = after.filter((note) => !sent.has(note.id)).length;
  const tooLong = new Set(selection.tooLong);
  const afterTooLong = after.filter((note) => tooLong.has(note.id)).length;
  return {
    ...empty,
    entries: selection.entries.map(sourceOf),
    ...(selection.coverage.truncated
      ? {
          coverage: {
            omittedEntryCount: selection.coverage.omittedEntryCount,
            truncated: true,
            ...(selection.tooLong.length > 0
              ? { tooLong: selection.tooLong.length }
              : {}),
            ...(afterOmitted > 0 ? { afterOmitted } : {}),
            ...(afterTooLong > 0 ? { afterTooLong } : {}),
          },
        }
      : {}),
  };
}
