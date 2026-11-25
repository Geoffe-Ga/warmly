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
import { toBase64, utf8 } from "../crypto/encoding";
import { hkdfParams, type RootKey } from "../crypto/root-key";

/** First line of every signed message. */
export const SIGNATURE_VERSION = "warmly-request-v1";
const ENROLLMENT_PROOF_VERSION = "warmly-device-enrollment-v1";
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
 * The value a new device must prove it knows before it may register. It is
 * derived one-way from the account root key, so the server can hold it
 * without learning anything about the key, and a stolen session token cannot
 * produce it.
 *
 * @param root - The account root key.
 * @returns 32 bytes, sent to the server once with the first recovery envelope.
 */
export async function deviceEnrollmentVerifier(
  root: RootKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const bits = await crypto.subtle.deriveBits(
    hkdfParams(utf8("warmly/device-enrollment/v1")),
    root.key,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Prove knowledge of the account root key when registering a device.
 *
 * @param root - The account root key.
 * @param deviceId - The device being registered.
 * @param publicKey - Its public key, base64, as it will be registered.
 * @returns `HMAC-SHA-256(verifier, version | device ID | public key)`, base64.
 */
export async function enrollmentProof(
  root: RootKey,
  deviceId: string,
  publicKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    await deviceEnrollmentVerifier(root),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const proof = await crypto.subtle.sign(
    "HMAC",
    key,
    utf8([ENROLLMENT_PROOF_VERSION, deviceId, publicKey].join("\n")),
  );
  return toBase64(new Uint8Array(proof));
}
