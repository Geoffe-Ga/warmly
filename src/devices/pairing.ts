/**
 * Pairing: an unlocked device hands the account root key to a new one
 * (PRD DEV-001 path A, AC-19; ADR-0005, D-07).
 *
 * The relay between the two devices is not trusted. The protocol is built so
 * that a relay which swaps a key or a random value in transit makes the two
 * devices compute different six-digit codes, and so that it cannot search
 * for values that make the codes agree:
 *
 * 1. The new device makes a one-time key pair and a random value, and sends
 *    the public key with a **commitment** to the random value.
 * 2. The approving device sends its own random value.
 * 3. Only then does the new device **reveal** its random value. The
 *    approving device checks it against the commitment.
 * 4. Both compute the code from everything exchanged. The new device shows
 *    it; the person types it into the approving device.
 * 5. If the typed code matches, the approving device encrypts the root key
 *    to the new device's public key (HPKE, RFC 9180) and sends it.
 *
 * Each side has fixed its random value before it learns the other's, so a
 * relay in the middle gets one blind guess in a million per attempt, and a
 * wrong code ends the attempt.
 */
import type { AuthClient, AuthSession } from "../auth/auth-client";
import {
  concat,
  fromBase64,
  lengthPrefixed,
  toBase64,
  utf8,
} from "../crypto/encoding";
import {
  HPKE_PUBLIC_KEY_BYTES,
  HpkeOpenError,
  generateRecipientKey,
  hpkeOpen,
  hpkeSeal,
} from "../crypto/hpke";
import type { DeviceIdentity, DeviceIdentityStore } from "./identity";
import type { PairingRelay, PairingRequest } from "./pairing-relay";

type Bytes = Uint8Array<ArrayBuffer>;

const NONCE_BYTES = 32;
const CODE_DIGITS = 6;
/** How often a device asks the relay whether the other has moved on. */
export const PAIRING_POLL_MS = 1_000;

/** Why a pairing ended without the key being handed over. */
export type PairingErrorCode =
  /** The five minutes ran out, or a newer request replaced this one. */
  | "pairing_expired"
  /** The approving device refused the request. */
  | "pairing_rejected"
  /** A value was changed in transit. Nothing was handed over. */
  | "pairing_tampered"
  /** The typed code was not the code this pairing produced. */
  | "pairing_code_mismatch"
  /** The screen was left before the pairing finished. */
  | "pairing_cancelled";

/** A pairing that ended early, with a reason the UI can explain. */
export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode) {
    super(`Pairing ended: ${code}`);
    this.name = "PairingError";
    this.code = code;
  }
}

/** How the approving device proves again that it may release the root key. */
export type RootKeyCredential =
  | { readonly kind: "device_passphrase"; readonly passphrase: string }
  | { readonly kind: "recovery_key"; readonly recoveryKey: string };

/** What pairing needs from the key vault. */
export interface RootKeyAccess {
  /**
   * Hand the raw root key to `use`, then wipe it. The unlocked key cannot be
   * exported, so it is opened again with the credential, which also confirms
   * that the person approving is the account's owner.
   *
   * @throws VaultError as for unlocking with that credential.
   */
  withRootKeyBytes<T>(
    credential: RootKeyCredential,
    use: (rootKeyBytes: Bytes) => Promise<T>,
  ): Promise<T>;
  /** Unlock this device with a root key received from another device. */
  acceptRootKey(rootKeyBytes: Bytes): Promise<void>;
}

/** What the new device's screen is told while pairing. */
export type JoinProgress =
  | { readonly kind: "waiting_for_approver" }
  | { readonly kind: "compare_code"; readonly code: string };

/** A request the approving device has taken up and checked. */
export interface Approval {
  /** When the request stops being usable. */
  readonly expiresAt: Date;
  /**
   * Hand the root key to the new device, if the typed code is right.
   *
   * @param typedCode - The code shown on the new device, as typed here.
   * @param credential - Re-opens the root key on this device.
   * @throws PairingError `pairing_code_mismatch` (the pairing is then over),
   *   `pairing_expired`; VaultError if the credential is wrong, after which
   *   this may be called again.
   */
  approve(typedCode: string, credential: RootKeyCredential): Promise<void>;
  /** Refuse the request. */
  reject(): Promise<void>;
}

/** What the pairing screens need. */
export interface DevicePairing {
  /**
   * New device: run a pairing to its end. Resolves once this device holds
   * the root key and is unlocked.
   *
   * @param onProgress - Told when to wait and when to show the code.
   * @param signal - Aborted when the screen is left.
   * @throws PairingError if the pairing ended early.
   */
  join(
    onProgress: (progress: JoinProgress) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /**
   * Approving device: take up the waiting request, if there is one.
   *
   * @param signal - Aborted when the screen is left.
   * @returns The request, ready for the code to be typed, or `undefined` if
   *   no device is waiting.
   * @throws PairingError `pairing_tampered` or `pairing_expired`.
   */
  takeUpRequest(signal: AbortSignal): Promise<Approval | undefined>;
}

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
function transferMessage(transcript: PairingTranscript): {
  info: Bytes;
  aad: Bytes;
} {
  return {
    info: transcriptBytes("warmly-root-key-transfer-v1", transcript),
    aad: new Uint8Array(0),
  };
}

function bytes(encoded: string, length: number): Bytes {
  let decoded: Bytes;
  try {
    decoded = fromBase64(encoded);
  } catch {
    throw new PairingError("pairing_tampered");
  }
  if (decoded.length !== length) {
    throw new PairingError("pairing_tampered");
  }
  return decoded;
}

/** Decode a wrapped key; anything undecodable counts as altered. */
function sealedKey(encoded: string): Bytes {
  try {
    return fromBase64(encoded);
  } catch {
    throw new PairingError("pairing_tampered");
  }
}

function sameBytes(left: Bytes, right: Bytes): boolean {
  return toBase64(left) === toBase64(right);
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** How a pairing waits between looks at the relay; tests pass their own. */
export interface PairingTiming {
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now: () => number;
}

/** Pairing between this device and another of the same account. */
export class AccountPairing implements DevicePairing {
  readonly #auth: AuthClient;
  readonly #identities: DeviceIdentityStore;
  readonly #relay: PairingRelay;
  readonly #keys: RootKeyAccess;
  readonly #timing: PairingTiming;

  /**
   * @param auth - Says who is signed in.
   * @param identities - This device's identity for each account.
   * @param relay - Passes messages between the two devices.
   * @param keys - Releases and accepts the root key.
   * @param timing - How to wait and tell the time; tests pass their own.
   */
  constructor(
    auth: AuthClient,
    identities: DeviceIdentityStore,
    relay: PairingRelay,
    keys: RootKeyAccess,
    timing: PairingTiming = { sleep: defaultSleep, now: () => Date.now() },
  ) {
    this.#auth = auth;
    this.#identities = identities;
    this.#relay = relay;
    this.#keys = keys;
    this.#timing = timing;
  }

  async #session(): Promise<AuthSession> {
    const session = await this.#auth.currentSession();
    if (session === undefined) {
      throw new PairingError("pairing_cancelled");
    }
    return session;
  }

  /** Ask the relay again and again until the request has moved on. */
  async #waitUntil(
    session: AuthSession,
    id: string,
    signal: AbortSignal,
    moved: (request: PairingRequest) => boolean,
  ): Promise<PairingRequest> {
    for (;;) {
      if (signal.aborted) {
        throw new PairingError("pairing_cancelled");
      }
      const request = await this.#relay.read(session, id);
      if (
        request === undefined ||
        request.status === "expired" ||
        Date.parse(request.expiresAt) <= this.#timing.now()
      ) {
        throw new PairingError("pairing_expired");
      }
      if (request.status === "rejected") {
        throw new PairingError("pairing_rejected");
      }
      if (moved(request)) {
        return request;
      }
      await this.#timing.sleep(PAIRING_POLL_MS, signal);
    }
  }

  async join(
    onProgress: (progress: JoinProgress) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const session = await this.#session();
    const identity = await this.#identities.getOrCreate(session.userId);
    const recipient = await generateRecipientKey();
    const joinerNonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const commitment = await pairingCommitment(
      identity.deviceId,
      recipient.publicKey,
      joinerNonce,
    );
    const started = await this.#relay.start(session, {
      deviceId: identity.deviceId,
      publicKey: toBase64(recipient.publicKey),
      commitment: toBase64(commitment),
    });
    onProgress({ kind: "waiting_for_approver" });

    const claimed = await this.#waitUntil(
      session,
      started.id,
      signal,
      (request) => request.approverNonce !== undefined,
    );
    // The values this device made are used as it made them, never as the
    // relay reports them back.
    const transcript: PairingTranscript = {
      owner: session.userId,
      requestId: started.id,
      deviceId: identity.deviceId,
      publicKey: recipient.publicKey,
      commitment,
      challenge: bytes(started.challenge, NONCE_BYTES),
      approverNonce: bytes(claimed.approverNonce ?? "", NONCE_BYTES),
      joinerNonce,
    };
    // Revealed only now, after the approving device has fixed its value.
    const revealed = await this.#relay.reveal(
      session,
      started.id,
      toBase64(joinerNonce),
    );
    if (revealed === undefined) {
      throw new PairingError("pairing_expired");
    }
    onProgress({ kind: "compare_code", code: await pairingCode(transcript) });

    const approved = await this.#waitUntil(
      session,
      started.id,
      signal,
      (request) => request.wrappedKey !== undefined,
    );
    let rootKeyBytes: Bytes;
    try {
      rootKeyBytes = await hpkeOpen(
        recipient,
        transferMessage(transcript),
        sealedKey(approved.wrappedKey ?? ""),
      );
    } catch (error) {
      if (error instanceof HpkeOpenError) {
        throw new PairingError("pairing_tampered");
      }
      throw error;
    }
    try {
      await this.#keys.acceptRootKey(rootKeyBytes);
    } finally {
      rootKeyBytes.fill(0);
    }
  }

  async takeUpRequest(signal: AbortSignal): Promise<Approval | undefined> {
    const session = await this.#session();
    const identity = await this.#identities.getOrCreate(session.userId);
    const waiting = await this.#relay.openRequest(session, identity);
    if (waiting === undefined) {
      return undefined;
    }
    const approverNonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const claimed = await this.#relay.claim(
      session,
      identity,
      waiting.id,
      toBase64(approverNonce),
    );
    if (claimed === undefined) {
      // Another of the account's devices took it up first.
      return undefined;
    }
    const revealed = await this.#waitUntil(
      session,
      waiting.id,
      signal,
      (request) => request.joinerNonce !== undefined,
    );
    // The key, commitment and challenge are the ones seen before this
    // device chose its value. The relay cannot change them afterwards.
    const transcript = await this.#checked(
      session,
      identity,
      waiting,
      approverNonce,
      revealed.joinerNonce ?? "",
    );
    return new ClaimedApproval(
      { session, identity, relay: this.#relay, keys: this.#keys },
      transcript,
      new Date(waiting.expiresAt),
    );
  }

  /** Build the transcript, refusing the request if a value does not fit. */
  async #checked(
    session: AuthSession,
    identity: DeviceIdentity,
    waiting: PairingRequest,
    approverNonce: Bytes,
    revealedNonce: string,
  ): Promise<PairingTranscript> {
    try {
      const publicKey = bytes(waiting.publicKey, HPKE_PUBLIC_KEY_BYTES);
      const commitment = bytes(waiting.commitment, NONCE_BYTES);
      const joinerNonce = bytes(revealedNonce, NONCE_BYTES);
      const expected = await pairingCommitment(
        waiting.deviceId,
        publicKey,
        joinerNonce,
      );
      if (!sameBytes(expected, commitment)) {
        throw new PairingError("pairing_tampered");
      }
      return {
        owner: session.userId,
        requestId: waiting.id,
        deviceId: waiting.deviceId,
        publicKey,
        commitment,
        challenge: bytes(waiting.challenge, NONCE_BYTES),
        approverNonce,
        joinerNonce,
      };
    } catch (error) {
      await this.#relay.reject(session, identity, waiting.id);
      throw error;
    }
  }
}

interface ApprovalContext {
  readonly session: AuthSession;
  readonly identity: DeviceIdentity;
  readonly relay: PairingRelay;
  readonly keys: RootKeyAccess;
}

/** See {@link Approval}. */
class ClaimedApproval implements Approval {
  readonly expiresAt: Date;
  readonly #context: ApprovalContext;
  readonly #transcript: PairingTranscript;
  #codeConfirmed = false;

  constructor(
    context: ApprovalContext,
    transcript: PairingTranscript,
    expiresAt: Date,
  ) {
    this.#context = context;
    this.#transcript = transcript;
    this.expiresAt = expiresAt;
  }

  async approve(
    typedCode: string,
    credential: RootKeyCredential,
  ): Promise<void> {
    const { session, identity, relay, keys } = this.#context;
    if (!this.#codeConfirmed) {
      const code = await pairingCode(this.#transcript);
      if (normalisePairingCode(typedCode) !== code) {
        // One guess per pairing: a second would let a code be searched for.
        await relay.reject(session, identity, this.#transcript.requestId);
        throw new PairingError("pairing_code_mismatch");
      }
      this.#codeConfirmed = true;
    }
    const wrapped = await keys.withRootKeyBytes(credential, (rootKeyBytes) =>
      hpkeSeal(
        this.#transcript.publicKey,
        transferMessage(this.#transcript),
        rootKeyBytes,
      ),
    );
    const approved = await relay.approve(
      session,
      identity,
      this.#transcript.requestId,
      toBase64(wrapped),
    );
    if (approved === undefined) {
      throw new PairingError("pairing_expired");
    }
  }

  async reject(): Promise<void> {
    const { session, identity, relay } = this.#context;
    await relay.reject(session, identity, this.#transcript.requestId);
  }
}

/** Stand-in for builds with no backend configured: pairing is unavailable. */
export class UnavailableDevicePairing implements DevicePairing {
  join(): Promise<void> {
    return Promise.reject(new PairingError("pairing_expired"));
  }

  takeUpRequest(): Promise<Approval | undefined> {
    return Promise.resolve(undefined);
  }
}
