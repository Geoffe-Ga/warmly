/**
 * In-memory stand-in for the Warmly API's pairing relay, for development and
 * the `e2e` build. It must never be part of a production build.
 *
 * It keeps the requests in `localStorage`, playing the part of the server,
 * so two tabs can pair as two devices. It applies the same rules as the real
 * API: each step happens once and in order, a request lasts five minutes,
 * starting a new one ends the account's earlier open ones, a revealed value
 * must match the commitment, only the device that claimed a request can
 * finish it, and an account sees only its own.
 *
 * It does not check request signatures. Those are covered by the API's own
 * tests.
 */
import type { AuthSession } from "../auth/auth-client";
import { fromBase64, toBase64 } from "../crypto/encoding";
import type { DeviceIdentity } from "../devices/identity";
import { pairingCommitment } from "../devices/pairing";
import type {
  PairingRelay,
  PairingRequest,
  PairingStart,
} from "../devices/pairing-relay";

/** Storage key for the fake server's pairing requests. */
export const FAKE_PAIRING_STORAGE_KEY = "warmly.fake.server.pairing";
const LIFETIME_MS = 5 * 60 * 1_000;
const OPEN = ["pending", "claimed", "revealed"];

interface Stored {
  owner: string;
  approver: string | undefined;
  expires: number;
  request: PairingRequest;
}

/** See the module comment. */
export class FakePairingRelay implements PairingRelay {
  readonly #storage: Storage;
  readonly #now: () => number;

  constructor(
    storage: Storage = localStorage,
    now: () => number = () => Date.now(),
  ) {
    this.#storage = storage;
    this.#now = now;
  }

  #all(): Stored[] {
    const raw = this.#storage.getItem(FAKE_PAIRING_STORAGE_KEY);
    return raw === null ? [] : (JSON.parse(raw) as Stored[]);
  }

  #save(all: Stored[]): void {
    this.#storage.setItem(FAKE_PAIRING_STORAGE_KEY, JSON.stringify(all));
  }

  /** Apply one step to the owner's unexpired request, if it is at `from`. */
  #step(
    session: AuthSession,
    id: string,
    from: readonly string[],
    approver: string | undefined,
    change: (stored: Stored) => Partial<PairingRequest>,
  ): Promise<PairingRequest | undefined> {
    const all = this.#all();
    const stored = all.find(
      (entry) => entry.owner === session.userId && entry.request.id === id,
    );
    if (
      stored === undefined ||
      stored.expires <= this.#now() ||
      !from.includes(stored.request.status) ||
      (approver !== undefined && stored.approver !== approver)
    ) {
      return Promise.resolve(undefined);
    }
    stored.request = { ...stored.request, ...change(stored) };
    this.#save(all);
    return Promise.resolve(stored.request);
  }

  start(session: AuthSession, start: PairingStart): Promise<PairingRequest> {
    const now = this.#now();
    const all = this.#all();
    for (const entry of all) {
      if (
        entry.owner === session.userId &&
        OPEN.includes(entry.request.status)
      ) {
        entry.expires = now;
      }
    }
    const request: PairingRequest = {
      id: crypto.randomUUID(),
      deviceId: start.deviceId,
      publicKey: start.publicKey,
      commitment: start.commitment,
      challenge: toBase64(crypto.getRandomValues(new Uint8Array(32))),
      status: "pending",
      expiresAt: new Date(now + LIFETIME_MS).toISOString(),
      approverNonce: undefined,
      joinerNonce: undefined,
      wrappedKey: undefined,
    };
    all.push({
      owner: session.userId,
      approver: undefined,
      expires: now + LIFETIME_MS,
      request,
    });
    this.#save(all);
    return Promise.resolve(request);
  }

  read(session: AuthSession, id: string): Promise<PairingRequest | undefined> {
    const stored = this.#all().find(
      (entry) => entry.owner === session.userId && entry.request.id === id,
    );
    if (stored === undefined) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(
      stored.expires <= this.#now()
        ? { ...stored.request, status: "expired", wrappedKey: undefined }
        : stored.request,
    );
  }

  openRequest(session: AuthSession): Promise<PairingRequest | undefined> {
    const waiting = this.#all().filter(
      (entry) =>
        entry.owner === session.userId &&
        entry.expires > this.#now() &&
        entry.request.status === "pending",
    );
    return Promise.resolve(waiting.at(-1)?.request);
  }

  claim(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
    approverNonce: string,
  ): Promise<PairingRequest | undefined> {
    return this.#step(session, id, ["pending"], undefined, (stored) => {
      stored.approver = identity.deviceId;
      return { status: "claimed", approverNonce };
    });
  }

  async reveal(
    session: AuthSession,
    id: string,
    joinerNonce: string,
  ): Promise<PairingRequest | undefined> {
    const stored = await this.read(session, id);
    if (stored === undefined || !(await this.#committed(stored, joinerNonce))) {
      return undefined;
    }
    return this.#step(session, id, ["claimed"], undefined, () => ({
      status: "revealed",
      joinerNonce,
    }));
  }

  /** Whether a revealed value is the one the request committed to. */
  async #committed(request: PairingRequest, nonce: string): Promise<boolean> {
    try {
      const expected = await pairingCommitment(
        request.deviceId,
        fromBase64(request.publicKey),
        fromBase64(nonce),
      );
      return toBase64(expected) === request.commitment;
    } catch {
      return false;
    }
  }

  approve(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
    wrappedKey: string,
  ): Promise<PairingRequest | undefined> {
    return this.#step(session, id, ["revealed"], identity.deviceId, () => ({
      status: "approved",
      wrappedKey,
    }));
  }

  async reject(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
  ): Promise<void> {
    await this.#step(
      session,
      id,
      ["claimed", "revealed"],
      identity.deviceId,
      () => ({ status: "rejected" }),
    );
  }
}
