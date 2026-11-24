/**
 * The real {@link KeyVault}: creates the account root key, wraps it with the
 * recovery key, and recovers it on a new device (PRD SEC-003, DEV-001 path B,
 * DEV-006; ADR-0003).
 *
 * Rules this class keeps:
 * - The server only ever receives the wrapped root key.
 * - New keys, and a new recovery key, take effect only after the user has
 *   confirmed they saved the recovery key. Until then nothing is stored
 *   anywhere, so an abandoned attempt leaves the account as it was.
 * - Replacing the recovery key is one compare-and-swap. If it does not
 *   happen, the old key still works.
 * - The account password is never involved.
 */
import type {
  RecoveryEnvelopeStore,
  StoredRecoveryEnvelope,
} from "../api/recovery-envelope-store";
import type { AuthClient, AuthSession } from "../auth/auth-client";
import type { DeviceKeyStore } from "./device-key-store";
import { VaultError, type KeyVault } from "./key-vault";
import {
  RecoveryKeyError,
  RecoveryUnwrapError,
  formatRecoveryKey,
  generateRecoverySecret,
  parseRecoveryKey,
  unwrapRootKey,
  wrapRootKey,
} from "./recovery";
import {
  fingerprint,
  generateRootKeyBytes,
  importRootKey,
  type RootKey,
} from "./root-key";

/** A recovery key prepared but not yet confirmed by the user. */
interface Pending {
  readonly kind: "create" | "rotate";
  readonly userId: string;
  /** The envelope version this change replaces; 0 when creating. */
  readonly expectedVersion: number;
  readonly secret: Uint8Array<ArrayBuffer>;
  readonly rootKeyBytes: Uint8Array<ArrayBuffer>;
}

function zero(bytes: Uint8Array): void {
  bytes.fill(0);
}

/** See the module comment. */
export class AccountVault implements KeyVault {
  readonly #auth: AuthClient;
  readonly #envelopes: RecoveryEnvelopeStore;
  readonly #device: DeviceKeyStore | undefined;
  #root: RootKey | undefined;
  #pending: Pending | undefined;

  /**
   * @param auth - Says who is signed in.
   * @param envelopes - Where the recovery envelope is kept.
   * @param device - This device's key store, if it has one. Without it,
   *   unlocking always takes the recovery key.
   */
  constructor(
    auth: AuthClient,
    envelopes: RecoveryEnvelopeStore,
    device?: DeviceKeyStore,
  ) {
    this.#auth = auth;
    this.#envelopes = envelopes;
    this.#device = device;
  }

  async #session(): Promise<AuthSession> {
    const session = await this.#auth.currentSession();
    if (session === undefined) {
      throw new VaultError("signed_out");
    }
    return session;
  }

  #dropPending(): void {
    if (this.#pending !== undefined) {
      zero(this.#pending.secret);
      zero(this.#pending.rootKeyBytes);
      this.#pending = undefined;
    }
  }

  async #adopt(
    userId: string,
    rootKeyBytes: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    this.#root = await importRootKey(rootKeyBytes);
    await this.#device?.save(userId, rootKeyBytes);
  }

  /** Open the stored envelope with a typed recovery key. */
  async #open(
    session: AuthSession,
    typedRecoveryKey: string,
  ): Promise<{
    stored: StoredRecoveryEnvelope;
    rootKeyBytes: Uint8Array<ArrayBuffer>;
  }> {
    let secret: Uint8Array<ArrayBuffer>;
    try {
      secret = await parseRecoveryKey(typedRecoveryKey);
    } catch (error) {
      if (error instanceof RecoveryKeyError) {
        throw new VaultError(`recovery_key_${error.problem}`);
      }
      throw error;
    }
    try {
      const stored = await this.#envelopes.read(session);
      if (stored === undefined) {
        throw new VaultError("no_account_keys");
      }
      const rootKeyBytes = await unwrapRootKey(
        secret,
        session.userId,
        stored.envelope,
      );
      return { stored, rootKeyBytes };
    } catch (error) {
      if (error instanceof RecoveryUnwrapError) {
        throw new VaultError("wrong_recovery_key");
      }
      throw error;
    } finally {
      zero(secret);
    }
  }

  async hasKeysOnThisDevice(): Promise<boolean> {
    const session = await this.#auth.currentSession();
    if (session === undefined || this.#device === undefined) {
      return false;
    }
    return (await this.#device.load(session.userId)) !== undefined;
  }

  async accountHasKeys(): Promise<boolean> {
    return (await this.#envelopes.read(await this.#session())) !== undefined;
  }

  async createAccountKeys(): Promise<string> {
    const session = await this.#session();
    this.#dropPending();
    const secret = generateRecoverySecret();
    this.#pending = {
      kind: "create",
      userId: session.userId,
      expectedVersion: 0,
      secret,
      rootKeyBytes: generateRootKeyBytes(),
    };
    return formatRecoveryKey(secret);
  }

  async confirmRecoveryKey(): Promise<void> {
    await this.#confirm("create", "keys_already_exist");
  }

  async unlock(): Promise<void> {
    const session = await this.#session();
    const rootKeyBytes = await this.#device?.load(session.userId);
    if (rootKeyBytes === undefined) {
      throw new VaultError("no_keys_on_device");
    }
    this.#root = await importRootKey(rootKeyBytes);
    zero(rootKeyBytes);
  }

  async unlockWithRecoveryKey(recoveryKey: string): Promise<void> {
    const session = await this.#session();
    const { rootKeyBytes } = await this.#open(session, recoveryKey);
    await this.#adopt(session.userId, rootKeyBytes);
    zero(rootKeyBytes);
  }

  async beginRecoveryKeyRotation(currentRecoveryKey: string): Promise<string> {
    const session = await this.#session();
    const { stored, rootKeyBytes } = await this.#open(
      session,
      currentRecoveryKey,
    );
    this.#dropPending();
    const secret = generateRecoverySecret();
    this.#pending = {
      kind: "rotate",
      userId: session.userId,
      expectedVersion: stored.version,
      secret,
      rootKeyBytes,
    };
    return formatRecoveryKey(secret);
  }

  async confirmRecoveryKeyRotation(): Promise<void> {
    await this.#confirm("rotate", "recovery_key_changed_elsewhere");
  }

  /** Save a pending change with compare-and-swap, then adopt its root key. */
  async #confirm(
    kind: Pending["kind"],
    conflict: "keys_already_exist" | "recovery_key_changed_elsewhere",
  ): Promise<void> {
    const pending = this.#pending;
    const session = await this.#session();
    if (pending?.kind !== kind || pending.userId !== session.userId) {
      throw new VaultError("nothing_to_confirm");
    }
    const envelope = await wrapRootKey(
      pending.secret,
      session.userId,
      pending.rootKeyBytes,
    );
    // If this write does not happen, the stored envelope is untouched and
    // the pending change is kept, so the user can try again.
    const saved = await this.#envelopes.write(
      session,
      pending.expectedVersion,
      envelope,
    );
    if (!saved) {
      this.#dropPending();
      throw new VaultError(conflict);
    }
    await this.#adopt(session.userId, pending.rootKeyBytes);
    this.#dropPending();
  }

  async fingerprint(): Promise<string | undefined> {
    return this.#root === undefined ? undefined : fingerprint(this.#root);
  }

  lock(): void {
    this.#root = undefined;
    this.#dropPending();
  }
}
