/**
 * In-memory stand-in for the Warmly API's recovery envelope, for development
 * and the `e2e` build. It must never be part of a production build.
 *
 * It keeps the envelopes in `localStorage`, playing the part of the server:
 * the value survives a reload and a lock, as a server's copy would. It applies
 * the same create and replace rules as the real API.
 */
import type {
  RecoveryEnvelopeStore,
  StoredRecoveryEnvelope,
} from "../api/recovery-envelope-store";
import type { AuthSession } from "../auth/auth-client";
import { fromBase64, toBase64 } from "../crypto/encoding";

/** Storage key for the fake server's envelopes. */
export const FAKE_RECOVERY_STORAGE_KEY = "warmly.fake.server.recovery";

type Stored = [userId: string, version: number, envelope: string][];

/** See the module comment. */
export class FakeRecoveryEnvelopeStore implements RecoveryEnvelopeStore {
  readonly #storage: Storage;

  constructor(storage: Storage = localStorage) {
    this.#storage = storage;
  }

  #all(): Stored {
    const raw = this.#storage.getItem(FAKE_RECOVERY_STORAGE_KEY);
    return raw === null ? [] : (JSON.parse(raw) as Stored);
  }

  read(session: AuthSession): Promise<StoredRecoveryEnvelope | undefined> {
    const found = this.#all().find(([userId]) => userId === session.userId);
    return Promise.resolve(
      found === undefined
        ? undefined
        : { version: found[1], envelope: fromBase64(found[2]) },
    );
  }

  write(
    session: AuthSession,
    expectedVersion: number,
    envelope: Uint8Array<ArrayBuffer>,
  ): Promise<boolean> {
    const all = this.#all();
    const current = all.find(([userId]) => userId === session.userId);
    if ((current?.[1] ?? 0) !== expectedVersion) {
      return Promise.resolve(false);
    }
    const others = all.filter(([userId]) => userId !== session.userId);
    others.push([session.userId, expectedVersion + 1, toBase64(envelope)]);
    this.#storage.setItem(FAKE_RECOVERY_STORAGE_KEY, JSON.stringify(others));
    return Promise.resolve(true);
  }
}
