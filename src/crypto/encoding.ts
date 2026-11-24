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
