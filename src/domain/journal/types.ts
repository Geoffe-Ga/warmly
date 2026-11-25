/**
 * The journal entry and its three prompts (PRD JR-001, §7).
 *
 * Everything here is private content. It exists in memory and, on disk,
 * only as ciphertext. It never goes in a URL, a log or an error message.
 */
import { contentHash } from "./content-hash";
import { inListOrder, isFeeling, type Feeling } from "./feelings";
import { PROMPTS, type Responses } from "./prompts";
import { canComplete } from "./validation";

export { PROMPTS } from "./prompts";
export type { Prompt, PromptKey, Responses } from "./prompts";

/** The day an entry is about, in the time zone it was written in. */
export interface EntryDate {
  /** The calendar day, as `YYYY-MM-DD`. */
  readonly date: string;
  /** An IANA time zone name, such as `Europe/Lisbon`. */
  readonly timeZone: string;
}

/** One journal entry. */
export interface JournalEntry {
  /** An opaque random UUID. It says nothing about when it was made. */
  readonly id: string;
  /** When the entry was first created, as an ISO 8601 instant. */
  readonly createdAt: string;
  readonly entryDate: EntryDate;
  /** When the entry was last changed, as an ISO 8601 instant. */
  readonly updatedAt: string;
  /** A draft is not a completed entry. */
  readonly status: "draft" | "complete";
  readonly responses: Responses;
  /** Feelings the person chose to note. Never inferred from the text. */
  readonly feelings?: readonly Feeling[];
  /** Hash of the three answers; see `content-hash.ts`. */
  readonly contentHash: string;
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isResponses(value: unknown): value is Responses {
  return (
    typeof value === "object" &&
    value !== null &&
    PROMPTS.every(
      (prompt) =>
        prompt.key in value &&
        isText((value as Record<string, unknown>)[prompt.key]),
    )
  );
}

function isEntryDate(value: unknown): value is EntryDate {
  return (
    typeof value === "object" &&
    value !== null &&
    "date" in value &&
    isText(value.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    "timeZone" in value &&
    isText(value.timeZone)
  );
}

/**
 * Check that a value read back from storage has the shape of an entry.
 * Decrypting proves a record is ours and unaltered, not that the code that
 * wrote it agreed with this code about its shape.
 *
 * @param value - What was decrypted.
 * @returns Whether it is a journal entry.
 */
export function isJournalEntry(value: unknown): value is JournalEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    isText(entry["id"]) &&
    isText(entry["createdAt"]) &&
    isText(entry["updatedAt"]) &&
    isText(entry["contentHash"]) &&
    (entry["status"] === "draft" || entry["status"] === "complete") &&
    isEntryDate(entry["entryDate"]) &&
    isResponses(entry["responses"]) &&
    (entry["feelings"] === undefined ||
      (Array.isArray(entry["feelings"]) && entry["feelings"].every(isFeeling)))
  );
}

/**
 * The calendar day and time zone for an instant, on this device.
 *
 * @param now - The instant.
 * @param timeZone - The zone to read the day in; defaults to the device's.
 * @returns The entry date.
 */
export function entryDateFor(
  now: Date,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): EntryDate {
  // The Swedish locale writes dates as YYYY-MM-DD.
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { date, timeZone };
}

/**
 * Build a new entry from what was typed.
 *
 * It is `complete` when all three answers have some text and a `draft`
 * otherwise. The compose screen builds its entries with `drafts.ts`, where
 * the status is chosen by what the person did, not by what is filled in.
 *
 * @param responses - The three answers, as typed.
 * @param now - The current time.
 * @param feelings - Feelings the person chose to note, if any.
 * @returns The entry, with a fresh random ID.
 */
export async function newEntry(
  responses: Responses,
  now: Date = new Date(),
  feelings: readonly Feeling[] = [],
): Promise<JournalEntry> {
  const instant = now.toISOString();
  const noted = inListOrder(feelings);
  return {
    id: crypto.randomUUID(),
    createdAt: instant,
    entryDate: entryDateFor(now),
    updatedAt: instant,
    status: canComplete(responses) ? "complete" : "draft",
    responses,
    // Left out entirely when none were chosen: no check-in is not the same
    // as a check-in that found nothing.
    ...(noted.length > 0 ? { feelings: noted } : {}),
    contentHash: await contentHash(responses),
  };
}
