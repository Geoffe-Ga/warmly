/**
 * An edit to a finished entry that the person has not saved yet
 * (ADR-0015; PRD JR-006, DEV-005).
 *
 * It is what the edit form held when the app locked, the page reloaded or
 * the tab was put away. It is never the entry and never changes it: the
 * entry is changed only when the person presses Save changes.
 */
import type { EntryContent } from "./drafts";
import { isFeeling } from "./feelings";
import { PROMPTS } from "./prompts";

const PROMPT_KEYS = PROMPTS.map((prompt) => prompt.key);

/** What the edit form held, and which version of the entry it started from. */
export interface UnfinishedEdit extends EntryContent {
  /**
   * The content hash of the entry when the edit began. If the entry's hash
   * is different now, it was changed somewhere else in the meantime.
   */
  readonly basedOn: string;
}

/**
 * Check that a decrypted value is an unfinished edit.
 *
 * @param value - What was decrypted.
 * @returns Whether it is one.
 */
export function isUnfinishedEdit(value: unknown): value is UnfinishedEdit {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const edit = value as Record<string, unknown>;
  const responses = edit["responses"];
  return (
    typeof edit["basedOn"] === "string" &&
    edit["basedOn"] !== "" &&
    typeof responses === "object" &&
    responses !== null &&
    PROMPT_KEYS.every(
      (key) => typeof (responses as Record<string, unknown>)[key] === "string",
    ) &&
    Array.isArray(edit["feelings"]) &&
    edit["feelings"].every(isFeeling)
  );
}

/**
 * Whether two versions of a form's content say the same thing.
 *
 * @param left - One version.
 * @param right - The other.
 * @returns Whether every answer and the chosen feelings are the same.
 */
export function sameContent(left: EntryContent, right: EntryContent): boolean {
  return (
    PROMPT_KEYS.every((key) => left.responses[key] === right.responses[key]) &&
    left.feelings.length === right.feelings.length &&
    left.feelings.every((feeling) => right.feelings.includes(feeling))
  );
}
