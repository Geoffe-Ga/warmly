/**
 * Reflect sessions: a person's own questions about their own journal, and
 * the checked answers they got (PRD RF-001 to RF-006, §7).
 *
 * Everything here is private content. An answer holds references into the
 * journal (entry, answer, character range and the entry's hash when it was
 * sent), never a copy of journal text.
 */
import type { ReflectionAnswer } from "../../ai/contracts";

/** Something the person asked. */
export interface ReflectQuestion {
  readonly id: string;
  readonly role: "question";
  /** The question, in the person's own words. */
  readonly text: string;
  /** When it was asked, as an ISO 8601 instant. */
  readonly at: string;
}

/** A checked answer from the AI provider. */
export interface ReflectAnswer {
  readonly id: string;
  readonly role: "answer";
  readonly answer: ReflectionAnswer;
  /** When it arrived, as an ISO 8601 instant. */
  readonly at: string;
}

/** One turn of a session. */
export type ReflectMessage = ReflectQuestion | ReflectAnswer;

/** One private conversation about the journal. */
export interface ReflectSession {
  /** An opaque random ID. */
  readonly id: string;
  /**
   * An active session can be asked more. A finished one is read-only.
   * Leaving the screen does not finish a session.
   */
  readonly status: "active" | "finished";
  /** Questions and answers, in order. */
  readonly messages: readonly ReflectMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The first thing asked in a session, to tell sessions apart in a list.
 *
 * @param session - The session.
 * @returns The first question, or an empty string if there is none.
 */
export function firstQuestion(session: ReflectSession): string {
  const first = session.messages.find((each) => each.role === "question");
  return first?.role === "question" ? first.text : "";
}
