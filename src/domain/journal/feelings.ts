/**
 * The feelings a person can note on a journal entry (PRD JR-003, D-21).
 *
 * Plain words only, nothing clinical. A feeling is only ever what the
 * person chose: the app never works one out from what they wrote, and never
 * uses one to judge or discount an entry.
 */

/** The fixed list, in the order it is shown. */
export const FEELINGS = [
  "calm",
  "happy",
  "grateful",
  "hopeful",
  "loved",
  "tired",
  "sad",
  "anxious",
  "frustrated",
  "lonely",
  "overwhelmed",
] as const;

/** One feeling from the list. */
export type Feeling = (typeof FEELINGS)[number];

/**
 * @param value - Any value.
 * @returns Whether it is one of the listed feelings.
 */
export function isFeeling(value: unknown): value is Feeling {
  return FEELINGS.some((feeling) => feeling === value);
}

/**
 * Put chosen feelings in a fixed form: each once, in list order.
 *
 * @param chosen - The feelings picked, in any order.
 * @returns The same feelings, without repeats, in the order of the list.
 */
export function inListOrder(chosen: readonly Feeling[]): Feeling[] {
  return FEELINGS.filter((feeling) => chosen.includes(feeling));
}
