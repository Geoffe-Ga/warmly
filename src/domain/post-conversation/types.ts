/**
 * A reflection written after a conversation (PRD PC-001 to PC-004, §7).
 *
 * It is its own kind of record. It is never a journal entry, is never
 * turned into one, and is never shown as one: its three questions are
 * different, and all of them are optional. It is private content, stored
 * and synced like any other record.
 *
 * Nothing else about the conversation is recorded: no agreements, no
 * outcome, no rating, and no link to the cards that were used.
 */
import { utf8 } from "../../crypto/encoding";
import { entryDateFor, type EntryDate } from "../journal/types";

/** The three answers' names, as they are stored and cited. */
export type AfterKey = "went_well" | "difficult" | "remember";

/** One question of the form. */
export interface AfterPrompt {
  readonly key: AfterKey;
  /** The question, word for word as the PRD gives it. */
  readonly label: string;
}

/** The questions, in order (PRD PC-001). */
export const AFTER_PROMPTS: readonly AfterPrompt[] = [
  { key: "went_well", label: "What went well?" },
  { key: "difficult", label: "What felt difficult or unresolved?" },
  { key: "remember", label: "What would you like to remember?" },
];

/** The three answers. Any of them may be empty, but not all. */
export type AfterResponses = Readonly<Record<AfterKey, string>>;

/** A reflection written after a conversation. */
export interface PostConversationReflection {
  /** An opaque random UUID. */
  readonly id: string;
  /** When it was first written, as an ISO 8601 instant. */
  readonly createdAt: string;
  /** The day it was written, where the person was. */
  readonly entryDate: EntryDate;
  /** When it was last changed, as an ISO 8601 instant. */
  readonly updatedAt: string;
  readonly responses: AfterResponses;
  /** Hash of the three answers; see {@link afterContentHash}. */
  readonly contentHash: string;
}

/** What the person is shown in lists, in place of "journal entry". */
export const AFTER_LABEL = "After a conversation";

/** The version of the canonical form the hash is taken over. */
export const AFTER_HASH_VERSION = 1;

/**
 * The exact text the hash is taken over. Changing it means a new
 * {@link AFTER_HASH_VERSION}.
 *
 * @param responses - The three answers.
 * @returns The canonical text.
 */
export function canonicalAfter(responses: AfterResponses): string {
  return JSON.stringify({
    v: AFTER_HASH_VERSION,
    kind: "post_conversation",
    went_well: responses.went_well.normalize("NFC"),
    difficult: responses.difficult.normalize("NFC"),
    remember: responses.remember.normalize("NFC"),
  });
}

/**
 * Hash the three answers, so that anything built from them can tell later
 * whether they have changed. The hash is private: it stays inside the
 * encrypted record.
 *
 * @param responses - The three answers.
 * @returns The SHA-256 of the canonical text, in lowercase hex.
 */
export async function afterContentHash(
  responses: AfterResponses,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8(canonicalAfter(responses)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Whether the form can be saved: at least one answer has some text that
 * is not only spaces. There is no minimum length.
 *
 * @param responses - The three answers.
 * @returns Whether there is anything to save.
 */
export function canSaveAfter(responses: AfterResponses): boolean {
  return AFTER_PROMPTS.some((prompt) => responses[prompt.key].trim() !== "");
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResponses(value: unknown): boolean {
  return (
    isObject(value) &&
    AFTER_PROMPTS.every((prompt) => isText(value[prompt.key])) &&
    // A journal entry's answers do not belong here.
    !("good" in value) &&
    !("improve" in value) &&
    !("loved" in value)
  );
}

function isDate(value: unknown): boolean {
  return (
    isObject(value) &&
    isText(value["date"]) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value["date"]) &&
    isText(value["timeZone"])
  );
}

/**
 * Check that a value read back from storage is one of these reflections.
 *
 * @param value - What was decrypted.
 * @returns Whether it has the shape of a post-conversation reflection.
 */
export function isPostConversationReflection(
  value: unknown,
): value is PostConversationReflection {
  return (
    isObject(value) &&
    isText(value["id"]) &&
    isText(value["createdAt"]) &&
    isText(value["updatedAt"]) &&
    isDate(value["entryDate"]) &&
    isResponses(value["responses"]) &&
    isText(value["contentHash"]) &&
    // It has no status and no feelings: it is not a journal entry.
    !("status" in value)
  );
}

/**
 * Make a new reflection from the form.
 *
 * @param responses - The three answers; at least one has text.
 * @param now - The current time.
 * @returns The reflection, not yet stored.
 */
export async function newAfter(
  responses: AfterResponses,
  now: Date = new Date(),
): Promise<PostConversationReflection> {
  const instant = now.toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: instant,
    entryDate: entryDateFor(now),
    updatedAt: instant,
    responses,
    contentHash: await afterContentHash(responses),
  };
}
