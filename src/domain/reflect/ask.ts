/**
 * Asking a question in a Reflect session (PRD RF-003, RF-006; AC-08).
 *
 * The steps around the one AI call: build the request from the journal
 * and from this session alone, and, when a checked answer has come back,
 * store it. Sending is not here: it happens only in the gateway, after
 * the person has agreed in the disclosure dialog. A failed or refused
 * call stores nothing, so the session stays exactly as it was.
 */
import type { EarlierTurn, ReflectRequest } from "../../ai/provider";
import type { JournalEntry } from "../journal/types";
import { reflectRequest, type RequestSizing } from "./request";
import {
  SessionFinishedError,
  type Exchange,
  type ReflectSessions,
} from "./sessions";
import type { ReflectSession } from "./types";

/**
 * The earlier turns of one session, as they are sent with a new question.
 *
 * Only questions that got an answer are included, each with the prose of
 * its answer. Citations are left out: they point into the journal by ID
 * and hash, which a provider is never given.
 *
 * @param session - The session being asked in, if there is one yet.
 * @returns The turns, oldest first. Empty for a new session.
 */
export function historyOf(session: ReflectSession | undefined): EarlierTurn[] {
  const turns: EarlierTurn[] = [];
  let question: string | undefined;
  for (const message of session?.messages ?? []) {
    if (message.role === "question") {
      question = message.text;
    } else if (question !== undefined) {
      turns.push({ question, answer: message.answer.markdown });
      question = undefined;
    }
  }
  return turns;
}

/**
 * Build the request for a question asked in a session.
 *
 * What goes in: the question, the finished journal entries that fit, and
 * the earlier turns of this session. Nothing from any other session, and
 * nothing the app remembers from before (PRD RF-006).
 *
 * @param input - The question; the journal; the session being asked in
 *   (none for a first question); and the gateway's sizing.
 * @returns The request. Nothing has been sent.
 * @throws InvalidQuestionError, SessionTooLongError or EntryTooLargeError,
 *   as `reflectRequest` does.
 */
export function askRequest(input: {
  readonly question: string;
  readonly entries: readonly JournalEntry[];
  readonly session: ReflectSession | undefined;
  readonly sizing: RequestSizing | undefined;
}): ReflectRequest {
  return reflectRequest(
    input.question,
    input.entries,
    input.sizing,
    historyOf(input.session),
  );
}

/**
 * Store a question and the checked answer it got: in its session, or in a
 * new one if there is none, or if that one has gone or was finished
 * meanwhile on another device. The answer is never thrown away.
 *
 * @param reflect - The sessions.
 * @param sessionId - The session the question was asked in, if any.
 * @param exchange - The question and its answer.
 * @returns The session that now holds them, and whether that is a
 *   different one from the one asked in.
 */
export async function storeExchange(
  reflect: ReflectSessions,
  sessionId: string | undefined,
  exchange: Exchange,
): Promise<{ session: ReflectSession; elsewhere: boolean }> {
  if (sessionId === undefined) {
    return { session: await reflect.start(exchange), elsewhere: false };
  }
  try {
    const added = await reflect.add(sessionId, exchange);
    if (added !== undefined) {
      return { session: added, elsewhere: false };
    }
  } catch (error) {
    if (!(error instanceof SessionFinishedError)) {
      throw error;
    }
  }
  return { session: await reflect.start(exchange), elsewhere: true };
}
