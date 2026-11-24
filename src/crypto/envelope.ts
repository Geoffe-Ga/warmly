/**
 * The versioned, authenticated record envelope (ADR-0003, PRD SEC-002).
 *
 * Layout, format version 1:
 *
 * ```
 * byte 0        format version (1)
 * bytes 1..12   nonce, 96 random bits
 * bytes 13..    AES-256-GCM ciphertext followed by its 128-bit tag
 * ```
 *
 * **Key.** Each record has its own AES-256-GCM key, derived from the root key
 * with HKDF-SHA-256 using the owner, the record ID and the format version as
 * context. Including the owner means two accounts could never derive the
 * same record key, even if a root key were ever shared between them.
 *
 * **Nonce policy.** Every encryption uses a fresh random 96-bit nonce. Because
 * a key is used for one record only, the number of encryptions under any key
 * is the number of times that record is saved, far below the level at which a
 * random nonce could plausibly repeat.
 *
 * **Associated data.** The owner, record ID, record type and format version
 * are authenticated with the ciphertext. Change any of them and decryption
 * fails, so the server cannot present one record as another, as another
 * owner's, or as a different type.
 */
import { concat, lengthPrefixed, utf8 } from "./encoding";
import { hkdfParams, type RootKey } from "./root-key";

/** The format version this code writes. */
export const FORMAT_VERSION = 1;
/** Nonce length in bytes. */
export const NONCE_BYTES = 12;

const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES;
const MAX_RECORD_TYPE = 255;
/** The identity a record is bound to. All of it is authenticated. */
export interface RecordContext {
  /** Account that owns the record. */
  readonly owner: string;
  /** Opaque record identifier. */
  readonly recordId: string;
  /** Record category, 0 to 255. */
  readonly type: number;
}

/**
 * Decryption failed. Deliberately says nothing about why: a wrong key, a
 * mismatched context and tampering are indistinguishable to a caller, and to
 * anyone watching.
 */
export class DecryptError extends Error {
  constructor() {
    super("The record could not be decrypted");
    this.name = "DecryptError";
  }
}

/** The envelope was written in a format this code does not know. */
export class UnsupportedFormatError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`Unsupported envelope format version ${String(version)}`);
    this.name = "UnsupportedFormatError";
    this.version = version;
  }
}

function associatedData(context: RecordContext): Uint8Array<ArrayBuffer> {
  if (
    !Number.isInteger(context.type) ||
    context.type < 0 ||
    context.type > MAX_RECORD_TYPE
  ) {
    throw new Error("The record type must be an integer from 0 to 255");
  }
  return concat(
    new Uint8Array([FORMAT_VERSION]),
    lengthPrefixed("owner", context.owner),
    lengthPrefixed("record", context.recordId),
    new Uint8Array([context.type]),
  );
}

async function recordKey(
  root: RootKey,
  context: RecordContext,
): Promise<CryptoKey> {
  const info = concat(
    utf8("warmly/record-key/"),
    new Uint8Array([FORMAT_VERSION]),
    lengthPrefixed("owner", context.owner),
    lengthPrefixed("record", context.recordId),
  );
  return crypto.subtle.deriveKey(
    hkdfParams(info),
    root.key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt one record.
 *
 * @param root - The account root key.
 * @param context - The owner, record ID and type the record is bound to.
 * @param plaintext - The record's bytes.
 * @returns The envelope.
 * @throws Error if the context is malformed.
 */
export async function seal(
  root: RootKey,
  context: RecordContext,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const additionalData = associatedData(context);
  const key = await recordKey(root, context);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData },
    key,
    plaintext,
  );
  return concat(
    new Uint8Array([FORMAT_VERSION]),
    nonce,
    new Uint8Array(ciphertext),
  );
}

/**
 * Decrypt one record.
 *
 * @param root - The account root key.
 * @param context - The owner, record ID and type the caller expects.
 * @param envelope - The envelope to open.
 * @returns The record's bytes.
 * @throws UnsupportedFormatError if the format version is unknown.
 * @throws DecryptError if the envelope is malformed, was tampered with, was
 *   made under another key, or does not belong to this context.
 * @throws Error if the context itself is malformed. That is a bug in the
 *   caller, not something an envelope can cause.
 */
export async function open(
  root: RootKey,
  context: RecordContext,
  envelope: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const version = envelope[0];
  if (version === undefined) {
    throw new DecryptError();
  }
  if (version !== FORMAT_VERSION) {
    throw new UnsupportedFormatError(version);
  }
  if (envelope.length < HEADER_BYTES + TAG_BYTES) {
    throw new DecryptError();
  }
  const additionalData = associatedData(context);
  const key = await recordKey(root, context);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: envelope.subarray(1, HEADER_BYTES),
        additionalData,
      },
      key,
      envelope.subarray(HEADER_BYTES),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new DecryptError();
  }
}

/**
 * Encrypt a JSON-serialisable record.
 *
 * @param root - The account root key.
 * @param context - The owner, record ID and type the record is bound to.
 * @param value - The record.
 * @returns The envelope.
 */
export async function sealJson(
  root: RootKey,
  context: RecordContext,
  value: unknown,
): Promise<Uint8Array<ArrayBuffer>> {
  return seal(root, context, utf8(JSON.stringify(value)));
}

/**
 * Decrypt a JSON record. The result is untyped: the caller must validate its
 * shape before use, as the encrypted store does for each record type.
 *
 * @param root - The account root key.
 * @param context - The owner, record ID and type the caller expects.
 * @param envelope - The envelope to open.
 * @returns The parsed record.
 * @throws DecryptError also when the decrypted bytes are not valid JSON.
 */
export async function openJson(
  root: RootKey,
  context: RecordContext,
  envelope: Uint8Array<ArrayBuffer>,
): Promise<unknown> {
  const plaintext = await open(root, context, envelope);
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    );
  } catch {
    throw new DecryptError();
  }
}
