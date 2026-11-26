/**
 * The passage a citation points to, carried from the answer to the entry
 * screen (PRD RF-005; AC-07).
 *
 * When the person follows a citation, the entry opens with the cited words
 * marked. Where those words are is held here, in memory, for that one
 * step. It is never put in the address, in storage or in history, and it
 * is dropped when the app locks.
 */
import type { SourceRef } from "../../ai/contracts";

/** Holds the one passage that was last pointed at, until it is shown. */
export class CitedPassage {
  #ref: SourceRef | undefined;

  /**
   * Remember the passage of a citation that is being followed.
   *
   * @param ref - Where the cited words are.
   */
  point(ref: SourceRef): void {
    this.#ref = ref;
  }

  /**
   * The passage to mark in an entry that is being opened. It is handed
   * over once: opening the entry again later marks nothing.
   *
   * @param entryId - The entry being opened.
   * @returns The passage, if one in this entry was just pointed at.
   */
  take(entryId: string): SourceRef | undefined {
    const ref = this.#ref;
    this.#ref = undefined;
    return ref?.entryId === entryId ? ref : undefined;
  }

  /** Forget the passage, for example when the app locks. */
  clear(): void {
    this.#ref = undefined;
  }
}
