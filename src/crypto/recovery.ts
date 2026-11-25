/**
 * The personal recovery key (ADR-0003, PRD SEC-003, DEV-001 path B).
 *
 * The recovery key is 256 random bits, shown to the user once as text. It
 * wraps the account root key, and the wrapped copy is all the server ever
 * holds. Because the key is already uniformly random, the wrapping key is
 * derived from it with HKDF; a slow password KDF would add nothing.
 *
 * **Text form.** 35 bytes (the 32-byte secret, then a 3-byte checksum) in
 * Crockford base32: 56 characters, shown as 14 groups of 4. The alphabet has
 * no I, L, O or U, and when typed, O is read as 0 and I or L as 1.
 *
 * **Recovery envelope, format version 1.**
 *
 * ```
 * byte 0        format version (1)
 * bytes 1..12   nonce, 96 random bits
 * bytes 13..    AES-256-GCM of the 32-byte root key, then its 128-bit tag
 * ```
 *
 * The owner is bound into both the wrapping key and the associated data, so
 * an envelope cannot be opened as another account's.
 */
import { concat, lengthPrefixed, utf8 } from "./encoding";
import { ROOT_KEY_BYTES } from "./root-key";

/** Length of the recovery secret in bytes (256 bits). */
export const RECOVERY_SECRET_BYTES = 32;
/** The recovery-envelope format this code writes. */
export const RECOVERY_FORMAT_VERSION = 1;

const CHECKSUM_BYTES = 3;
const GROUP = 4;
const ENCODED_LENGTH = ((RECOVERY_SECRET_BYTES + CHECKSUM_BYTES) * 8) / 5;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_BYTES = 1 + NONCE_BYTES + ROOT_KEY_BYTES + TAG_BYTES;
// Crockford base32: the digits, then the letters without I, L, O and U.
const ALPHABET = ["0123456789", "ABCDEFGH", "JKMNPQRST", "VWXYZ"].join("");
// Letters people type when they mean a digit that looks the same.
const LOOKALIKES: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" };
const HKDF_SALT = utf8("warmly/hkdf-salt/v1");

/** Why a typed recovery key could not be used. */
export type RecoveryKeyProblem = "malformed" | "mistyped";

/**
 * A typed recovery key is not usable as typed. `malformed` means it is the
 * wrong length or has characters a key never contains; `mistyped` means it
 * has the right shape but its checksum does not match.
 */
export class RecoveryKeyError extends Error {
  readonly problem: RecoveryKeyProblem;

  constructor(problem: RecoveryKeyProblem) {
    super(`The recovery key is ${problem}`);
    this.name = "RecoveryKeyError";
    this.problem = problem;
  }
}

/**
 * The recovery envelope could not be opened: the key is not the one that
 * made it, it belongs to another account, or it was altered. Deliberately
 * does not say which.
 */
export class RecoveryUnwrapError extends Error {
  constructor() {
    super("The recovery envelope could not be opened");
    this.name = "RecoveryUnwrapError";
  }
}

/** The recovery envelope was written in a format this code does not know. */
export class UnsupportedRecoveryFormatError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`Unsupported recovery envelope format version ${String(version)}`);
    this.name = "UnsupportedRecoveryFormatError";
    this.version = version;
  }
}

/**
 * Generate a new recovery secret from the platform's secure random source.
 *
 * @returns 32 random bytes. Show them once with {@link formatRecoveryKey};
 *   never store or send them.
 */
export function generateRecoverySecret(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(RECOVERY_SECRET_BYTES));
}

async function checksum(
  secret: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    concat(utf8("warmly/recovery-check/v1"), secret),
  );
  return new Uint8Array(digest).slice(0, CHECKSUM_BYTES);
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += ALPHABET.charAt((value >> bits) & 31);
    }
  }
  return text;
}

// The caller has already checked the length, so the text holds a whole
// number of bytes: 56 characters are exactly 35 bytes.
function fromBase32(text: string): Uint8Array<ArrayBuffer> | undefined {
  const bytes = new Uint8Array((text.length * 5) / 8);
  let bits = 0;
  let value = 0;
  let offset = 0;
  for (const character of text) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) {
      return undefined;
    }
    value = ((value << 5) | digit) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset] = (value >> bits) & 0xff;
      offset += 1;
    }
  }
  return bytes;
}

/**
 * Turn a recovery secret into the text shown to the user.
 *
 * @param secret - The 32-byte recovery secret.
 * @returns 14 dash-separated groups of 4 characters.
 * @throws Error if the secret is not 32 bytes long.
 */
export async function formatRecoveryKey(
  secret: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (secret.length !== RECOVERY_SECRET_BYTES) {
    throw new Error(
      `A recovery secret must be ${String(RECOVERY_SECRET_BYTES)} bytes`,
    );
  }
  const encoded = toBase32(concat(secret, await checksum(secret)));
  return (encoded.match(/.{4}/g) ?? []).join("-");
}

/**
 * Tidy a typed recovery key: upper case, without spaces or dashes, and with
 * look-alike letters read as the digits they stand for.
 *
 * @param typed - What the user entered.
 * @returns The key's characters in canonical form, ungrouped.
 */
export function normaliseRecoveryKey(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[OIL]/g, (letter) => LOOKALIKES[letter] ?? letter);
}

/**
 * The final group of a recovery key as shown, used to check that the user
 * really saved it.
 *
 * @param recoveryKey - A key in its dash-separated form.
 * @returns The last group.
 */
export function lastGroupOf(recoveryKey: string): string {
  return normaliseRecoveryKey(recoveryKey).slice(-GROUP);
}

/**
 * Read a typed recovery key back into its secret, catching typos.
 *
 * @param typed - What the user entered. Case, spaces and dashes are ignored.
 * @returns The 32-byte recovery secret.
 * @throws RecoveryKeyError `malformed` or `mistyped`.
 */
export async function parseRecoveryKey(
  typed: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const text = normaliseRecoveryKey(typed);
  const bytes = text.length === ENCODED_LENGTH ? fromBase32(text) : undefined;
  if (bytes === undefined) {
    throw new RecoveryKeyError("malformed");
  }
  const secret = bytes.slice(0, RECOVERY_SECRET_BYTES);
  const expected = await checksum(secret);
  const given = bytes.subarray(RECOVERY_SECRET_BYTES);
  // Not secret-dependent in any useful way: the checksum only catches typos.
  if (!expected.every((byte, index) => byte === given[index])) {
    throw new RecoveryKeyError("mistyped");
  }
  return secret;
}

async function wrappingKey(
  secret: Uint8Array<ArrayBuffer>,
  owner: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: concat(
        utf8("warmly/recovery-wrap/"),
        new Uint8Array([RECOVERY_FORMAT_VERSION]),
        lengthPrefixed("owner", owner),
      ),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function associatedData(owner: string): Uint8Array<ArrayBuffer> {
  return concat(
    utf8("warmly/recovery-envelope/"),
    new Uint8Array([RECOVERY_FORMAT_VERSION]),
    lengthPrefixed("owner", owner),
  );
}

/**
 * Wrap root-key material under a recovery secret.
 *
 * @param secret - The 32-byte recovery secret.
 * @param owner - The account the envelope belongs to.
 * @param rootKeyBytes - The 32 bytes of root-key material.
 * @returns The recovery envelope, safe to store on the server.
 * @throws Error if the root-key material is not 32 bytes long.
 */
export async function wrapRootKey(
  secret: Uint8Array<ArrayBuffer>,
  owner: string,
  rootKeyBytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (rootKeyBytes.length !== ROOT_KEY_BYTES) {
    throw new Error(
      `Root key material must be ${String(ROOT_KEY_BYTES)} bytes`,
    );
  }
  const additionalData = associatedData(owner);
  const key = await wrappingKey(secret, owner);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData },
    key,
    rootKeyBytes,
  );
  return concat(
    new Uint8Array([RECOVERY_FORMAT_VERSION]),
    nonce,
    new Uint8Array(wrapped),
  );
}

/**
 * Open a recovery envelope.
 *
 * @param secret - The 32-byte recovery secret.
 * @param owner - The account the caller expects the envelope to belong to.
 * @param envelope - The recovery envelope from the server.
 * @returns The 32 bytes of root-key material. Import them at once.
 * @throws UnsupportedRecoveryFormatError if the format version is unknown.
 * @throws RecoveryUnwrapError if the secret is wrong, the envelope belongs to
 *   another account, or it is malformed or altered.
 */
export async function unwrapRootKey(
  secret: Uint8Array<ArrayBuffer>,
  owner: string,
  envelope: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const version = envelope[0];
  if (version === undefined) {
    throw new RecoveryUnwrapError();
  }
  if (version !== RECOVERY_FORMAT_VERSION) {
    throw new UnsupportedRecoveryFormatError(version);
  }
  if (envelope.length !== ENVELOPE_BYTES) {
    throw new RecoveryUnwrapError();
  }
  const additionalData = associatedData(owner);
  const key = await wrappingKey(secret, owner);
  try {
    const rootKeyBytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: envelope.subarray(1, 1 + NONCE_BYTES),
        additionalData,
      },
      key,
      envelope.subarray(1 + NONCE_BYTES),
    );
    return new Uint8Array(rootKeyBytes);
  } catch {
    throw new RecoveryUnwrapError();
  }
}
