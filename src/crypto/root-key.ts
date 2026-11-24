/**
 * The account root key (ADR-0003, PRD SEC-002).
 *
 * One random 256-bit key per account, generated on the client. Every other
 * key is derived from it. The server never receives it, and nothing derives
 * it from the account password.
 *
 * Its raw bytes exist only at two moments: when it is generated, and when it
 * is unwrapped from a recovery or device envelope. They are handed straight to
 * {@link importRootKey}, which returns a handle that cannot be exported.
 */
import { utf8 } from "./encoding";

/** Length of the root key in bytes (256 bits). */
export const ROOT_KEY_BYTES = 32;

const HKDF_HASH = "SHA-256";
// A fixed, public salt. The root key is already uniformly random, so the salt
// adds no secrecy; it only fixes the derivation to this application.
const HKDF_SALT = utf8("warmly/hkdf-salt/v1");

/** A handle to the root key. The key material itself cannot be read back. */
export interface RootKey {
  /** HKDF key; usable only to derive other keys and bits. */
  readonly key: CryptoKey;
}

/**
 * Generate fresh root-key material from the platform's secure random source.
 *
 * @returns 32 random bytes. Wrap or import them at once; never store them.
 */
export function generateRootKeyBytes(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(ROOT_KEY_BYTES));
}

/**
 * Turn root-key material into a non-exportable handle.
 *
 * @param bytes - Exactly 32 bytes of key material.
 * @returns The root key handle.
 * @throws Error if the material is not 32 bytes long.
 */
export async function importRootKey(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<RootKey> {
  if (bytes.length !== ROOT_KEY_BYTES) {
    throw new Error(
      `Root key material must be ${String(ROOT_KEY_BYTES)} bytes`,
    );
  }
  const key = await crypto.subtle.importKey("raw", bytes, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
  return { key };
}

/**
 * HKDF parameters for one purpose. Each distinct `info` yields an independent
 * key, so keys for different purposes or records can never collide.
 *
 * @param info - Bytes naming the purpose and its context.
 * @returns Parameters for `deriveKey` or `deriveBits`.
 */
export function hkdfParams(info: Uint8Array<ArrayBuffer>): HkdfParams {
  return { name: "HKDF", hash: HKDF_HASH, salt: HKDF_SALT, info };
}

/**
 * A short public identifier for a root key, for checking that two devices
 * hold the same one. It is derived one-way, so it reveals nothing about the
 * key and cannot be used to decrypt anything. At 64 bits it is a label for
 * people to compare, not proof of anything: never use it to authenticate a
 * device or to authorise an action.
 *
 * @param root - The root key.
 * @returns 16 lower-case hex characters.
 */
export async function fingerprint(root: RootKey): Promise<string> {
  const bits = await crypto.subtle.deriveBits(
    hkdfParams(utf8("warmly/fingerprint/v1")),
    root.key,
    64,
  );
  return [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
