/**
 * Hybrid Public Key Encryption, RFC 9180, for handing the root key to a new
 * device (ADR-0005, D-07).
 *
 * One fixed suite, in base mode: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256 and
 * AES-256-GCM. Only single-shot encryption is implemented: one message per
 * key encapsulation, which is all a pairing needs. It is written directly on
 * WebCrypto, because the project takes no cryptography dependency, and is
 * checked against the RFC's own test vectors.
 *
 * A sealed message is `enc || ciphertext`: the sender's one-time public key
 * (65 bytes) followed by the AES-GCM output.
 */
import { concat, utf8 } from "./encoding";

const KEM_ID = 0x0010;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0002;
const HASH_BYTES = 32;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
/** Length of a serialised P-256 public key: an uncompressed point. */
export const HPKE_PUBLIC_KEY_BYTES = 65;

const CURVE = { name: "ECDH", namedCurve: "P-256" } as const;
const VERSION = utf8("HPKE-v1");

type Bytes = Uint8Array<ArrayBuffer>;

/** The message could not be opened. Deliberately says nothing about why. */
export class HpkeOpenError extends Error {
  constructor() {
    super("The sealed message could not be opened");
    this.name = "HpkeOpenError";
  }
}

function i2osp(value: number, length: number): Bytes {
  const out = new Uint8Array(length);
  for (let index = length - 1, rest = value; index >= 0; index -= 1) {
    out[index] = rest & 0xff;
    rest >>>= 8;
  }
  return out;
}

const KEM_SUITE = concat(utf8("KEM"), i2osp(KEM_ID, 2));
const HPKE_SUITE = concat(
  utf8("HPKE"),
  i2osp(KEM_ID, 2),
  i2osp(KDF_ID, 2),
  i2osp(AEAD_ID, 2),
);

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const handle = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", handle, data));
}

/** HKDF-Extract with a labelled input (RFC 9180 section 4). */
function labeledExtract(
  suite: Bytes,
  salt: Bytes | undefined,
  label: string,
  ikm: Bytes,
): Promise<Bytes> {
  // An absent salt is a string of zeros as long as the hash output.
  return hmac(
    salt ?? new Uint8Array(HASH_BYTES),
    concat(VERSION, suite, utf8(label), ikm),
  );
}

/** HKDF-Expand with a labelled info (RFC 9180 section 4). */
async function labeledExpand(
  suite: Bytes,
  prk: Bytes,
  label: string,
  info: Bytes,
  length: number,
): Promise<Bytes> {
  const labeled = concat(i2osp(length, 2), VERSION, suite, utf8(label), info);
  let block: Bytes = new Uint8Array(0);
  let output: Bytes = new Uint8Array(0);
  for (let counter = 1; output.length < length; counter += 1) {
    block = await hmac(prk, concat(block, labeled, i2osp(counter, 1)));
    output = concat(output, block);
  }
  return output.slice(0, length);
}

async function sharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  enc: Bytes,
  recipient: Bytes,
): Promise<Bytes> {
  const dh = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      privateKey,
      256,
    ),
  );
  const prk = await labeledExtract(KEM_SUITE, undefined, "eae_prk", dh);
  return labeledExpand(
    KEM_SUITE,
    prk,
    "shared_secret",
    concat(enc, recipient),
    HASH_BYTES,
  );
}

async function keySchedule(
  shared: Bytes,
  info: Bytes,
): Promise<{ key: CryptoKey; nonce: Bytes }> {
  const empty = new Uint8Array(0);
  const context = concat(
    // Mode 0: base, with no pre-shared key and no sender authentication.
    i2osp(0, 1),
    await labeledExtract(HPKE_SUITE, undefined, "psk_id_hash", empty),
    await labeledExtract(HPKE_SUITE, undefined, "info_hash", info),
  );
  const secret = await labeledExtract(HPKE_SUITE, shared, "secret", empty);
  const key = await labeledExpand(
    HPKE_SUITE,
    secret,
    "key",
    context,
    KEY_BYTES,
  );
  const nonce = await labeledExpand(
    HPKE_SUITE,
    secret,
    "base_nonce",
    context,
    NONCE_BYTES,
  );
  return {
    key: await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
    // A single message uses sequence number 0, so the nonce is the base nonce.
    nonce,
  };
}

function importPublicKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, CURVE, true, []);
}

/** What goes into and comes out of one sealed message. */
export interface HpkeMessage {
  /** Binds the message to its purpose and context; both sides must agree. */
  readonly info: Bytes;
  /** Authenticated but not encrypted. */
  readonly aad: Bytes;
}

/**
 * Make a key pair for receiving one sealed message. The private key cannot
 * be exported.
 *
 * @returns The key pair and the public key as 65 bytes to give the sender.
 */
export async function generateRecipientKey(): Promise<{
  readonly privateKey: CryptoKey;
  readonly publicKey: Bytes;
}> {
  const pair = await crypto.subtle.generateKey(CURVE, false, ["deriveBits"]);
  return {
    privateKey: pair.privateKey,
    publicKey: new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ),
  };
}

/**
 * Encrypt one message to a recipient's public key.
 *
 * @param recipientPublicKey - The recipient's 65-byte public key.
 * @param message - The info and associated data.
 * @param plaintext - What to encrypt.
 * @param ephemeral - The sender's one-time key pair. Only the test vectors
 *   pass one; otherwise a fresh pair is generated, as it must be.
 * @returns `enc || ciphertext`.
 * @throws Error if the recipient key is not a valid P-256 point.
 */
export async function hpkeSeal(
  recipientPublicKey: Bytes,
  message: HpkeMessage,
  plaintext: Bytes,
  ephemeral?: CryptoKeyPair,
): Promise<Bytes> {
  const recipient = await importPublicKey(recipientPublicKey);
  const pair =
    ephemeral ??
    (await crypto.subtle.generateKey(CURVE, false, ["deriveBits"]));
  const enc = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const shared = await sharedSecret(
    pair.privateKey,
    recipient,
    enc,
    recipientPublicKey,
  );
  const { key, nonce } = await keySchedule(shared, message.info);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: message.aad },
    key,
    plaintext,
  );
  return concat(enc, new Uint8Array(ciphertext));
}

/**
 * Open a message sealed to this recipient.
 *
 * @param recipient - The recipient's private key and its 65-byte public key.
 * @param message - The info and associated data the sender used.
 * @param sealed - `enc || ciphertext`.
 * @returns The plaintext.
 * @throws HpkeOpenError if the message is malformed, was altered, was sealed
 *   to another key, or was sealed with different info or associated data.
 */
export async function hpkeOpen(
  recipient: { readonly privateKey: CryptoKey; readonly publicKey: Bytes },
  message: HpkeMessage,
  sealed: Bytes,
): Promise<Bytes> {
  try {
    const enc = sealed.slice(0, HPKE_PUBLIC_KEY_BYTES);
    const shared = await sharedSecret(
      recipient.privateKey,
      await importPublicKey(enc),
      enc,
      recipient.publicKey,
    );
    const { key, nonce } = await keySchedule(shared, message.info);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: message.aad },
        key,
        sealed.slice(HPKE_PUBLIC_KEY_BYTES),
      ),
    );
  } catch {
    throw new HpkeOpenError();
  }
}
