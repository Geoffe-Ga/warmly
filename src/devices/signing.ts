/**
 * What a device signs, and how it proves it may register (ADR-0005, D-06).
 *
 * Every request to the Warmly API is signed with a key that never leaves the
 * device. The server checks the signature against the public key that device
 * registered, so a stolen session token is not enough to act as the account.
 *
 * The signed message is seven lines joined by `\n`:
 *
 * ```
 * warmly-request-v1
 * METHOD
 * path and query, exactly as sent
 * SHA-256 of the body, lower-case hex
 * timestamp, whole seconds since the epoch
 * nonce
 * device ID
 * ```
 */
import { concat, fromBase64, toBase64, utf8 } from "../crypto/encoding";
import { hkdfParams, type RootKey } from "../crypto/root-key";

/** First line of every signed message. */
export const SIGNATURE_VERSION = "warmly-request-v1";
/** First line of what the enrollment proof signs. */
export const ENROLLMENT_PROOF_VERSION = "warmly-device-enrollment-v2";
const NONCE_BYTES = 18;

/** The parts of a request that its signature covers. */
export interface RequestToSign {
  readonly method: string;
  /** Path and query string, exactly as they will be sent. */
  readonly target: string;
  readonly body: Uint8Array<ArrayBuffer>;
  readonly deviceId: string;
  /** Whole seconds since the epoch. */
  readonly timestamp: number;
  readonly nonce: string;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the exact bytes a device signs for a request.
 *
 * @param request - The request's signed parts.
 * @returns The message.
 */
export async function signingMessage(
  request: RequestToSign,
): Promise<Uint8Array<ArrayBuffer>> {
  const bodyHash = await crypto.subtle.digest("SHA-256", request.body);
  return utf8(
    [
      SIGNATURE_VERSION,
      request.method.toUpperCase(),
      request.target,
      hex(new Uint8Array(bodyHash)),
      String(request.timestamp),
      request.nonce,
      request.deviceId,
    ].join("\n"),
  );
}

/**
 * Make a fresh nonce: 18 random bytes in URL-safe base64, 24 characters.
 *
 * @returns The nonce.
 */
export function newNonce(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)))
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

/**
 * The wrapping PKCS#8 puts round a 32-byte Ed25519 private seed (RFC 8410).
 * WebCrypto imports a private key in this form and works the public key
 * out itself.
 */
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);
const ED25519 = { name: "Ed25519" } as const;
/** A 32-byte key in base64, with its one padding character. */
const KEY_BASE64_LENGTH = 44;

/**
 * The account's enrollment key pair: an Ed25519 key whose private half is
 * derived from the account root key, so every device that holds the root
 * key can make it again and nothing else can (ADR-0005).
 *
 * @param root - The account root key.
 * @param extractable - Whether the key may be exported. Only reading the
 *   public half needs that.
 * @returns The private key.
 */
async function enrollmentSigningKey(
  root: RootKey,
  extractable: boolean,
): Promise<CryptoKey> {
  const seed = new Uint8Array(
    await crypto.subtle.deriveBits(
      hkdfParams(utf8("warmly/device-enrollment/v2")),
      root.key,
      256,
    ),
  );
  const pkcs8 = concat(ED25519_PKCS8_PREFIX, seed);
  try {
    return await crypto.subtle.importKey("pkcs8", pkcs8, ED25519, extractable, [
      "sign",
    ]);
  } finally {
    seed.fill(0);
    pkcs8.fill(0);
  }
}

/**
 * The public half of the account's enrollment key. The server keeps it and
 * checks a new device's registration against it. It is public: holding it
 * lets nobody register a device, which is the point of it (issue 84).
 *
 * @param root - The account root key.
 * @returns 32 bytes, sent to the server once with the first recovery envelope.
 */
export async function deviceEnrollmentKey(
  root: RootKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const jwk = await crypto.subtle.exportKey(
    "jwk",
    await enrollmentSigningKey(root, true),
  );
  if (jwk.x === undefined) {
    throw new Error("The enrollment key has no public half.");
  }
  // JWK uses the URL-safe alphabet with no padding.
  return fromBase64(
    jwk.x
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(KEY_BASE64_LENGTH, "="),
  );
}

/**
 * Prove knowledge of the account root key when registering a device.
 *
 * @param root - The account root key.
 * @param deviceId - The device being registered.
 * @param publicKey - Its public key, base64, as it will be registered.
 * @returns An Ed25519 signature over `version | device ID | public key`,
 *   made with the enrollment key, base64.
 */
export async function enrollmentProof(
  root: RootKey,
  deviceId: string,
  publicKey: string,
): Promise<string> {
  const proof = await crypto.subtle.sign(
    ED25519,
    await enrollmentSigningKey(root, false),
    utf8([ENROLLMENT_PROOF_VERSION, deviceId, publicKey].join("\n")),
  );
  return toBase64(new Uint8Array(proof));
}
