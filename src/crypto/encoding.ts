/**
 * Byte and text encodings used by the crypto layer.
 *
 * Envelopes travel to the API as standard base64 (the alphabet with `+` and
 * `/`, padded), which is the shape the API validates for opaque payloads.
 */

const CHUNK = 0x8000;

/**
 * Encode text as UTF-8 bytes.
 *
 * @param text - The text to encode.
 * @returns The UTF-8 bytes.
 */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

/**
 * Encode bytes as standard base64.
 *
 * @param bytes - The bytes to encode.
 * @returns The base64 text.
 */
export function toBase64(bytes: Uint8Array): string {
  // Built in chunks: spreading a large array into one call overflows the stack.
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decode standard base64.
 *
 * @param text - Base64 text.
 * @returns The decoded bytes.
 * @throws Error if the text is not valid base64.
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new Error("Value is not valid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Join byte arrays end to end.
 *
 * @param parts - The arrays to join, in order.
 * @returns One array holding all of them.
 */
export function concat(
  ...parts: readonly Uint8Array[]
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

const MAX_IDENTIFIER_BYTES = 0xffff;
// With the `u` flag a valid surrogate pair is one code point, so this matches
// only a surrogate that has no partner.
const UNPAIRED_SURROGATE = /\p{Cs}/u;

/**
 * Encode an identifier with a two-byte big-endian length in front, so that
 * fields placed side by side can never run together: "ab"+"c" stays distinct
 * from "a"+"bc".
 *
 * @param label - What the identifier is, for the error message.
 * @param value - The identifier.
 * @returns The length followed by the UTF-8 bytes.
 * @throws Error if the identifier is empty, longer than 65535 bytes, or not
 *   well-formed text. An unpaired surrogate has no UTF-8 form and would be
 *   silently replaced, which could make two different identifiers encode to
 *   the same bytes.
 */
export function lengthPrefixed(
  label: string,
  value: string,
): Uint8Array<ArrayBuffer> {
  if (UNPAIRED_SURROGATE.test(value)) {
    throw new Error(`The ${label} identifier is not well-formed text`);
  }
  const bytes = utf8(value);
  if (bytes.length === 0 || bytes.length > MAX_IDENTIFIER_BYTES) {
    throw new Error(`The ${label} identifier must be 1 to 65535 bytes long`);
  }
  return concat(
    new Uint8Array([bytes.length >> 8, bytes.length & 0xff]),
    bytes,
  );
}
