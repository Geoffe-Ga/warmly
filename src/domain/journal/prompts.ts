/**
 * The three journal prompts and the answers to them (PRD JR-001).
 */

/** Which of the three prompts a response answers. */
export type PromptKey = "good" | "improve" | "loved";

/** One journal prompt. */
export interface Prompt {
  readonly key: PromptKey;
  /** The question, word for word as the PRD gives it. */
  readonly label: string;
}

/** The three prompts, in the order every entry shows them (JR-001). */
export const PROMPTS: readonly Prompt[] = [
  { key: "good", label: "What's going well?" },
  { key: "improve", label: "What would you like to improve?" },
  {
    key: "loved",
    label:
      "Since your last journal entry, how has your partner helped you feel loved?",
  },
];

/** The answers to the three prompts. */
export type Responses = Readonly<Record<PromptKey, string>>;
