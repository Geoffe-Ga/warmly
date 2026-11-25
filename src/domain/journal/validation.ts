/**
 * When a journal entry counts as complete (PRD JR-002; AC-02).
 *
 * Each of the three answers needs some text that is not only spaces. There
 * is no minimum length and no check of what the text says: "Nothing comes
 * to mind this week" is a complete answer, and is never read as proof that
 * nothing happened (JR-008).
 */
import { PROMPTS, type PromptKey, type Responses } from "./prompts";

/** Said under an answer that is still empty when the person tries to finish. */
export const ANSWER_NEEDED =
  "Write something here to finish the entry. If nothing comes to mind, you can say just that.";

/**
 * White space is what `String.prototype.trim` removes: spaces, tabs, line
 * breaks and the Unicode space separators. Invisible characters that are
 * not white space, such as a zero-width space (U+200B), count as text. That is a
 * decision: the rule only stops an answer being left empty by accident, and
 * guessing at what a person meant by what they typed is not this app's job.
 *
 * @param answer - One answer, as typed.
 * @returns Whether it has any text other than white space.
 */
export function hasText(answer: string): boolean {
  return answer.trim() !== "";
}

/**
 * @param responses - The three answers.
 * @returns The prompts that still have no answer, in prompt order.
 */
export function unanswered(responses: Responses): PromptKey[] {
  return PROMPTS.map((prompt) => prompt.key).filter(
    (key) => !hasText(responses[key]),
  );
}

/**
 * @param responses - The three answers.
 * @returns Whether the entry can be completed.
 */
export function canComplete(responses: Responses): boolean {
  return unanswered(responses).length === 0;
}
