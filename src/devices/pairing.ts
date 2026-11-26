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
 *    to the new device's public key (HPKE, RFC 9180) and sends it, together
 *    with a random **confirmation code** that it also shows on its screen.
 * 6. The new device opens the message and asks for the confirmation code.
 *    Only if the person types the one the approving device shows does it
 *    keep the key.
 *
 * Each side has fixed its random value before it learns the other's, so a
 * relay in the middle gets one blind guess in a million per attempt, and a
 * wrong code ends the attempt.
 *
 * The two codes protect the two directions. The first makes sure the
 * approving device sends the key to the real new device. The second makes
 * sure the new device keeps a key that the real approving device sent:
 * without it, a relay could seal a key of its own choosing to the new
 * device, which would then encrypt the journal under a key the relay knows.
 */
import type { AuthClient, AuthSession } from "../auth/auth-client";
import { concat, toBase64, utf8 } from "../crypto/encoding";
import {
  HPKE_PUBLIC_KEY_BYTES,
  HpkeOpenError,
  generateRecipientKey,
  hpkeOpen,
  hpkeSeal,
} from "../crypto/hpke";
import type { DeviceIdentity, DeviceIdentityStore } from "./identity";
import {
  CODE_DIGITS,
  NONCE_BYTES,
  ROOT_KEY_BYTES,
  decoded,
  newConfirmationCode,
  normalisePairingCode,
  pairingCode,
  pairingCommitment,
  sameBytes,
  sealedKey,
  transferMessage,
  type PairingTranscript,
} from "./pairing-codes";
import type { PairingRelay, PairingRequest } from "./pairing-relay";
import {
  PairingError,
  type Approval,
  type DevicePairing,
  type JoinConfirmation,
  type JoinProgress,
  type RootKeyAccess,
  type RootKeyCredential,
} from "./pairing-types";

export {
  formatPairingCode,
  newConfirmationCode,
  normalisePairingCode,
  pairingCode,
  pairingCommitment,
  type PairingTranscript,
} from "./pairing-codes";
export {
  PairingError,
  type Approval,
  type DevicePairing,
  type JoinConfirmation,
  type JoinProgress,
  type PairingErrorCode,
  type RootKeyAccess,
  type RootKeyCredential,
} from "./pairing-types";

type Bytes = Uint8Array<ArrayBuffer>;

/** How often a device asks the relay whether the other has moved on. */
export const PAIRING_POLL_MS = 1_000;

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
      if (signal.aborted) {
        // Leaving the screen cancels the request on the relay, and an
        // answer already on its way can then say the request is gone. The
        // person left: that is what happened, not an expiry.
        throw new PairingError("pairing_cancelled");
      }
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
  ): Promise<JoinConfirmation> {
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
    // Leaving the screen gives the request up at once, so it does not sit
    // open for an approving device to find. Best effort: it expires anyway.
    signal.addEventListener(
      "abort",
      () => {
        this.#relay.cancel(session, started.id).catch(() => undefined);
      },
      { once: true },
    );

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
      challenge: decoded(started.challenge, NONCE_BYTES),
      approverNonce: decoded(claimed.approverNonce ?? "", NONCE_BYTES),
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
    let received: Bytes;
    try {
      received = await hpkeOpen(
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
    if (received.length !== ROOT_KEY_BYTES + CODE_DIGITS) {
      received.fill(0);
      throw new PairingError("pairing_tampered");
    }
    // Whoever sealed this knew the new device's public key, and so does the
    // relay. The key is kept only once the person has typed the code the
    // approving device shows, which the relay never sees.
    return new ReceivedKey(received, this.#keys, signal);
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
      const publicKey = decoded(waiting.publicKey, HPKE_PUBLIC_KEY_BYTES);
      const commitment = decoded(waiting.commitment, NONCE_BYTES);
      const joinerNonce = decoded(revealedNonce, NONCE_BYTES);
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
        challenge: decoded(waiting.challenge, NONCE_BYTES),
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
  ): Promise<string> {
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
    const confirmation = newConfirmationCode();
    const wrapped = await keys.withRootKeyBytes(
      credential,
      async (rootKeyBytes) => {
        const message = concat(rootKeyBytes, utf8(confirmation));
        try {
          return await hpkeSeal(
            this.#transcript.publicKey,
            transferMessage(this.#transcript),
            message,
          );
        } finally {
          message.fill(0);
        }
      },
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
    return confirmation;
  }

  async reject(): Promise<void> {
    const { session, identity, relay } = this.#context;
    await relay.reject(session, identity, this.#transcript.requestId);
  }
}

/** See {@link JoinConfirmation}. */
class ReceivedKey implements JoinConfirmation {
  readonly #received: Bytes;
  readonly #keys: RootKeyAccess;
  #open = true;

  constructor(received: Bytes, keys: RootKeyAccess, signal: AbortSignal) {
    this.#received = received;
    this.#keys = keys;
    signal.addEventListener(
      "abort",
      () => {
        this.#discard();
      },
      { once: true },
    );
    if (signal.aborted) {
      this.#discard();
    }
  }

  #discard(): void {
    this.#open = false;
    this.#received.fill(0);
  }

  async confirm(typedCode: string): Promise<void> {
    if (!this.#open) {
      throw new PairingError("pairing_expired");
    }
    const expected = new TextDecoder().decode(
      this.#received.slice(ROOT_KEY_BYTES),
    );
    if (normalisePairingCode(typedCode) !== expected) {
      // One guess, as for the first code. The key is thrown away.
      this.#discard();
      throw new PairingError("pairing_confirmation_mismatch");
    }
    this.#open = false;
    const rootKeyBytes = this.#received.slice(0, ROOT_KEY_BYTES);
    try {
      await this.#keys.acceptRootKey(rootKeyBytes);
    } finally {
      rootKeyBytes.fill(0);
      this.#received.fill(0);
    }
  }
}

/** Stand-in for builds with no backend configured: pairing is unavailable. */
export class UnavailableDevicePairing implements DevicePairing {
  join(): Promise<JoinConfirmation> {
    return Promise.reject(new PairingError("pairing_expired"));
  }

  takeUpRequest(): Promise<Approval | undefined> {
    return Promise.resolve(undefined);
  }
}
