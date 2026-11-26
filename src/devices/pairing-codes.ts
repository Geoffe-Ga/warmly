/**
 * The values a pairing is checked with: the commitment, the six-digit code
 * both devices derive, the confirmation code, and what binds a transferred
 * key to one pairing (ADR-0005).
 *
 * Nothing here talks to the relay or holds a key. The protocol that uses
 * these, and why it is shaped the way it is, is in `pairing.ts`.
 */
import { concat, fromBase64, lengthPrefixed, utf8 } from "../crypto/encoding";
import { PairingError } from "./pairing-types";

type Bytes = Uint8Array<ArrayBuffer>;

/** The length of each device's random value, and of the commitment. */
export const NONCE_BYTES = 32;
/** The length of the account root key. */
export const ROOT_KEY_BYTES = 32;
/** The length of the pairing code and of the confirmation code. */
export const CODE_DIGITS = 6;
/** The values a pairing code is computed from. */
export interface PairingTranscript {
  readonly owner: string;
  readonly requestId: string;
  readonly deviceId: string;
  readonly publicKey: Bytes;
  readonly commitment: Bytes;
  readonly challenge: Bytes;
  readonly approverNonce: Bytes;
  readonly joinerNonce: Bytes;
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/**
 * Commit to the new device's random value without revealing it.
 *
 * @param deviceId - The new device's ID.
 * @param publicKey - Its one-time public key.
 * @param joinerNonce - The random value, revealed later.
 * @returns The 32-byte commitment.
 */
export function pairingCommitment(
  deviceId: string,
  publicKey: Bytes,
  joinerNonce: Bytes,
): Promise<Bytes> {
  return sha256(
    concat(
      utf8("warmly-pairing-commit-v1"),
      lengthPrefixed("device", deviceId),
      publicKey,
      joinerNonce,
    ),
  );
}

function transcriptBytes(label: string, transcript: PairingTranscript): Bytes {
  return concat(
    utf8(label),
    lengthPrefixed("owner", transcript.owner),
    lengthPrefixed("request", transcript.requestId),
    lengthPrefixed("device", transcript.deviceId),
    transcript.publicKey,
    transcript.commitment,
    transcript.challenge,
    transcript.approverNonce,
    transcript.joinerNonce,
  );
}

/**
 * The six-digit code both devices derive from everything they exchanged.
 *
 * @param transcript - The exchanged values, as this device saw them.
 * @returns Six digits. Two devices that saw different values get different
 *   codes, except by a one-in-a-million coincidence.
 */
export async function pairingCode(
  transcript: PairingTranscript,
): Promise<string> {
  const digest = await sha256(
    transcriptBytes("warmly-pairing-code-v1", transcript),
  );
  const number = new DataView(digest.buffer).getUint32(0);
  // 2^32 is not a multiple of a million, so the lowest codes are very
  // slightly likelier than the rest: by about one part in four thousand,
  // which does not help anyone guess one.
  return String(number % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

/**
 * Write a code the way it is shown: two groups of three digits.
 *
 * @param code - Six digits.
 * @returns For example "042 917".
 */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * Reduce a typed code to its digits, so spaces and dashes do not matter.
 *
 * @param typed - What the person typed.
 * @returns The digits only.
 */
export function normalisePairingCode(typed: string): string {
  return typed.replace(/\D/g, "");
}

/** Bind the key transfer to this pairing, so it cannot be used in another. */
export function transferMessage(transcript: PairingTranscript): {
  info: Bytes;
  aad: Bytes;
} {
  return {
    info: transcriptBytes("warmly-root-key-transfer-v1", transcript),
    aad: new Uint8Array(0),
  };
}

/**
 * Decode a value of a known length; anything else counts as altered.
 *
 * @param encoded - The value as the relay gave it.
 * @param length - How many bytes it must be.
 * @returns The bytes.
 * @throws PairingError `pairing_tampered`.
 */
export function decoded(encoded: string, length: number): Bytes {
  let value: Bytes;
  try {
    value = fromBase64(encoded);
  } catch {
    throw new PairingError("pairing_tampered");
  }
  if (value.length !== length) {
    throw new PairingError("pairing_tampered");
  }
  return value;
}

/** Decode a wrapped key; anything undecodable counts as altered. */
export function sealedKey(encoded: string): Bytes {
  try {
    return fromBase64(encoded);
  } catch {
    throw new PairingError("pairing_tampered");
  }
}

/** Whether two byte strings are the same. Neither is a secret. */
export function sameBytes(left: Bytes, right: Bytes): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

/**
 * Pick a confirmation code: six digits, every code equally likely.
 *
 * @returns The code.
 */
export function newConfirmationCode(): string {
  const span = 10 ** CODE_DIGITS;
  // Values at the top of the range are thrown away, so that taking the
  // remainder does not favour the low codes.
  const limit = Math.floor(2 ** 32 / span) * span;
  const draw = new Uint32Array(1);
  do {
    crypto.getRandomValues(draw);
  } while ((draw[0] ?? limit) >= limit);
  return String((draw[0] ?? 0) % span).padStart(CODE_DIGITS, "0");
}
