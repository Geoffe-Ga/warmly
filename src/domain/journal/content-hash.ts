/**
 * The content hash of a journal entry (PRD §7; D-24).
 *
 * The hash identifies exactly what an entry says. Later, AI output records
 * the hash of each entry it was built from, so the app can tell when that
 * entry has since changed.
 *
 * It covers the three answers and nothing else. Feelings are left out on
 * purpose: changing a feeling must not throw away work built from the text.
 */
import { utf8 } from "../../crypto/encoding";
import type { Responses } from "./types";

/**
 * The version of the hash's canonical form. It is part of what is hashed,
 * so a future form can never produce the same hash for different content.
 */
export const CONTENT_HASH_VERSION = 1;

/**
 * The exact text that is hashed: JSON with the version and the three
 * answers, always in this key order, with no spacing. Each answer is put in
 * Unicode NFC first, so the same words hash the same however a keyboard
 * composed their accents. The stored answers are not changed.
 *
 * @param responses - The three answers.
 * @returns The canonical form.
 */
export function canonicalContent(responses: Responses): string {
  return JSON.stringify({
    v: CONTENT_HASH_VERSION,
    good: responses.good.normalize("NFC"),
    improve: responses.improve.normalize("NFC"),
    loved: responses.loved.normalize("NFC"),
  });
}

/**
 * Hash what an entry says.
 *
 * @param responses - The three answers.
 * @returns SHA-256 of {@link canonicalContent} as UTF-8, in lower-case hex.
 */
export async function contentHash(responses: Responses): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8(canonicalContent(responses)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
