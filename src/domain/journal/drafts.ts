/**
 * Drafts: an entry being written, saved as it is typed (PRD JR-004).
 *
 * A draft is a journal entry with `status: "draft"`, encrypted and stored
 * like any other record. It is not a completed entry. Nothing here calls
 * AI or the network: saving a draft only writes to this device.
 */
import { contentHash } from "./content-hash";
import { inListOrder, type Feeling } from "./feelings";
import type { Responses } from "./prompts";
import { entryDateFor, type JournalEntry } from "./types";
import { hasText } from "./validation";

/** What the person has put on the compose form. */
export interface EntryContent {
  readonly responses: Responses;
  readonly feelings: readonly Feeling[];
}

/** An empty form. */
export const BLANK: EntryContent = {
  responses: { good: "", improve: "", loved: "" },
  feelings: [],
};

/**
 * @param content - The form's content.
 * @returns Whether nothing has been written or chosen. A blank form is not
 *   worth a draft.
 */
export function isBlank(content: EntryContent): boolean {
  return (
    content.feelings.length === 0 &&
    !Object.values(content.responses).some(hasText)
  );
}

async function build(
  content: EntryContent,
  status: JournalEntry["status"],
  existing: JournalEntry | undefined,
  now: Date,
): Promise<JournalEntry> {
  const instant = now.toISOString();
  const noted = inListOrder(content.feelings);
  return {
    // A draft that is saved again, or completed, stays the same entry: its
    // ID, creation time and day do not change.
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? instant,
    entryDate: existing?.entryDate ?? entryDateFor(now),
    updatedAt: instant,
    status,
    responses: content.responses,
    ...(noted.length > 0 ? { feelings: noted } : {}),
    contentHash: await contentHash(content.responses),
  };
}

/**
 * Build the draft to store for what is on the form.
 *
 * @param content - The form's content.
 * @param existing - The draft already stored for this form, if any.
 * @param now - The current time.
 * @returns The draft. It is a draft even if every answer is filled in:
 *   only the person finishing the entry makes it complete.
 */
export function draftFrom(
  content: EntryContent,
  existing?: JournalEntry,
  now: Date = new Date(),
): Promise<JournalEntry> {
  return build(content, "draft", existing, now);
}

/**
 * Build the completed entry for what is on the form. The caller has
 * already checked that it can be completed.
 *
 * @param content - The form's content.
 * @param existing - The draft this entry grew from, if any.
 * @param now - The current time.
 * @returns The completed entry, with the draft's ID and creation time.
 */
export function completedFrom(
  content: EntryContent,
  existing?: JournalEntry,
  now: Date = new Date(),
): Promise<JournalEntry> {
  return build(content, "complete", existing, now);
}

/**
 * Pick the draft to carry on with. There is one draft at a time; if older
 * data holds more, the most recently changed one is used.
 *
 * @param entries - Every stored entry.
 * @returns The draft, or `undefined` if there is none.
 */
export function currentDraft(
  entries: readonly JournalEntry[],
): JournalEntry | undefined {
  return entries
    .filter((entry) => entry.status === "draft")
    .reduce<JournalEntry | undefined>(
      // ISO 8601 instants in UTC sort as plain text.
      (newest, entry) =>
        newest === undefined || entry.updatedAt > newest.updatedAt
          ? entry
          : newest,
      undefined,
    );
}

/** How long after the last change a draft is saved. */
export const AUTOSAVE_DELAY_MS = 800;

/** Where an autosave stands. */
export type SaveState = "idle" | "waiting" | "saving" | "saved" | "failed";

/**
 * Saves the latest value a short while after it last changed, and at once
 * when asked to flush. Saves never overlap: one that is asked for while
 * another is running waits, and only the newest value is saved.
 */
export class Autosave<T> {
  readonly #save: (value: T) => Promise<void>;
  readonly #onState: (state: SaveState) => void;
  readonly #delayMs: number;
  #pending: { readonly value: T } | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;

  /**
   * @param save - Stores a value. A rejection is reported as `failed`.
   * @param onState - Told each time the state changes.
   * @param delayMs - How long to wait after the last change.
   */
  constructor(
    save: (value: T) => Promise<void>,
    onState: (state: SaveState) => void,
    delayMs: number = AUTOSAVE_DELAY_MS,
  ) {
    this.#save = save;
    this.#onState = onState;
    this.#delayMs = delayMs;
  }

  /**
   * Note a new value. It is saved once nothing has changed for the delay.
   *
   * @param value - The latest value.
   */
  changed(value: T): void {
    this.#pending = { value };
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      void this.flush();
    }, this.#delayMs);
    this.#onState("waiting");
  }

  /**
   * Save now whatever is waiting, and wait for any save already running.
   * Used before the app locks and when the page is hidden or closed.
   *
   * @returns A promise that settles when nothing is left to save. It never
   *   rejects: a failed save is reported through the state.
   */
  flush(): Promise<void> {
    this.#clearTimer();
    this.#running ??= this.#drain().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  /** Forget a value that is waiting, without saving it. */
  cancel(): void {
    this.#clearTimer();
    this.#pending = undefined;
  }

  #clearTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #drain(): Promise<void> {
    // A value that arrives while a save is running has its own timer and
    // waits for it, unless a flush has cleared that timer meanwhile.
    while (this.#pending !== undefined && this.#timer === undefined) {
      const { value } = this.#pending;
      this.#pending = undefined;
      this.#onState("saving");
      let state: SaveState = "saved";
      try {
        await this.#save(value);
      } catch {
        state = "failed";
      }
      // If a newer value arrived meanwhile, its own save reports the state.
      if (this.#pending === undefined) {
        this.#onState(state);
      }
    }
  }
}
