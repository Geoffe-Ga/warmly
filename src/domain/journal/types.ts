/**
 * The journal entry and its three prompts (PRD JR-001, §7).
 *
 * Everything here is private content. It exists in memory and, once storage
 * arrives, on disk only as ciphertext. It never goes in a URL, a log or an
 * error message.
 */
import { utf8 } from "../../crypto/encoding";

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
  readonly feelings?: readonly string[];
  /** SHA-256 of the responses and feelings, lower-case hex. */
  readonly contentHash: string;
}

/**
 * Hash what an entry says, so that later a quotation can be checked against
 * the exact text it came from.
 *
 * @param responses - The three answers.
 * @param feelings - The noted feelings, if any.
 * @returns SHA-256 over a fixed JSON form of both, lower-case hex.
 */
export async function contentHash(
  responses: Responses,
  feelings: readonly string[] = [],
): Promise<string> {
  // Keys are written in a fixed order, so the same content always hashes
  // the same whatever order the object was built in.
  const canonical = JSON.stringify([
    responses.good,
    responses.improve,
    responses.loved,
    [...feelings],
  ]);
  const digest = await crypto.subtle.digest("SHA-256", utf8(canonical));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
 * otherwise. Telling the person what is missing belongs to the compose
 * screen, not here.
 *
 * @param responses - The three answers, as typed.
 * @param now - The current time.
 * @returns The entry, with a fresh random ID.
 */
export async function newEntry(
  responses: Responses,
  now: Date = new Date(),
): Promise<JournalEntry> {
  const instant = now.toISOString();
  const answered = PROMPTS.every(
    (prompt) => responses[prompt.key].trim() !== "",
  );
  return {
    id: crypto.randomUUID(),
    createdAt: instant,
    entryDate: entryDateFor(now),
    updatedAt: instant,
    status: answered ? "complete" : "draft",
    responses,
    contentHash: await contentHash(responses),
  };
}
