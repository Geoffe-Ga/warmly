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

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWhole(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isListOf(value: unknown, item: (each: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(item);
}

function isSourceRef(value: unknown): boolean {
  return (
    isObject(value) &&
    isText(value["entryId"]) &&
    (value["responseKey"] === "good" ||
      value["responseKey"] === "improve" ||
      value["responseKey"] === "loved") &&
    isWhole(value["start"]) &&
    isWhole(value["end"]) &&
    // A reference points at some words: never at none, never backwards.
    (value["start"] as number) < (value["end"] as number) &&
    isText(value["sourceHash"])
  );
}

/** Whether every turn has its own ID, so a turn can be told from another. */
function hasDistinctIds(messages: unknown): boolean {
  if (!Array.isArray(messages)) {
    return false;
  }
  const ids = messages.map((message: unknown) =>
    isObject(message) ? message["id"] : undefined,
  );
  return new Set(ids).size === ids.length;
}

function isCitation(value: unknown): boolean {
  return (
    isObject(value) &&
    isText(value["claimId"]) &&
    isListOf(value["evidence"], isSourceRef)
  );
}

function isCoverage(value: unknown): boolean {
  return (
    isObject(value) &&
    isListOf(value["includedEntryIds"], isText) &&
    isWhole(value["omittedEntryCount"]) &&
    typeof value["truncated"] === "boolean"
  );
}

function isSentSource(value: unknown): boolean {
  return (
    isObject(value) && isText(value["entryId"]) && isText(value["sourceHash"])
  );
}

function isAnswer(value: unknown): boolean {
  return (
    isObject(value) &&
    isText(value["markdown"]) &&
    isListOf(value["citations"], isCitation) &&
    // Without the entries it was built from, an answer could never be
    // found stale, so a record that lacks them is not a session.
    isListOf(value["sources"], isSentSource) &&
    isCoverage(value["coverage"])
  );
}

function isMessage(value: unknown): boolean {
  if (!isObject(value) || !isText(value["id"]) || !isText(value["at"])) {
    return false;
  }
  return value["role"] === "question"
    ? isText(value["text"])
    : value["role"] === "answer" && isAnswer(value["answer"]);
}

/**
 * Check that a value read back from storage has the shape of a session.
 *
 * @param value - What was decrypted.
 * @returns Whether it is a Reflect session.
 */
export function isReflectSession(value: unknown): value is ReflectSession {
  return (
    isObject(value) &&
    isText(value["id"]) &&
    (value["status"] === "active" || value["status"] === "finished") &&
    isListOf(value["messages"], isMessage) &&
    hasDistinctIds(value["messages"]) &&
    isText(value["createdAt"]) &&
    isText(value["updatedAt"])
  );
}
