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
import type { RootKeyAccess, RootKeyCredential } from "../devices/pairing";
import { deviceEnrollmentVerifier } from "../devices/signing";
import {
  DeviceLockedOutError,
  DevicePassphraseError,
  DeviceStoreDamagedError,
  type DeviceKeyStore,
} from "./device-key-store";
import { VaultError, type KeyVault } from "./key-vault";
import {
  RECOVERY_FORMAT_VERSION,
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
export class AccountVault implements KeyVault, RootKeyAccess {
  readonly #auth: AuthClient;
  readonly #envelopes: RecoveryEnvelopeStore;
  readonly #device: DeviceKeyStore | undefined;
  readonly #afterUnlock: ((root: RootKey) => void) | undefined;
  #root: RootKey | undefined;
  #pending: Pending | undefined;
  /**
   * Root-key material held just after the vault was opened with the recovery
   * key, so the user can choose to trust this device. It is wiped as soon as
   * they decide, and on lock.
   */
  #toTrust:
    { userId: string; rootKeyBytes: Uint8Array<ArrayBuffer> } | undefined;

  /**
   * @param auth - Says who is signed in.
   * @param envelopes - Where the recovery envelope is kept.
   * @param device - This device's key store. Without one, unlocking always
   *   takes the recovery key.
   * @param afterUnlock - Called each time the vault is unlocked, with the
   *   root key. Unlocking does not wait for it, so it must not throw.
   */
  constructor(
    auth: AuthClient,
    envelopes: RecoveryEnvelopeStore,
    device?: DeviceKeyStore,
    afterUnlock?: (root: RootKey) => void,
  ) {
    this.#auth = auth;
    this.#envelopes = envelopes;
    this.#device = device;
    this.#afterUnlock = afterUnlock;
  }

  /**
   * The root key, for code that encrypts and decrypts records.
   *
   * @returns The key handle while unlocked, otherwise `undefined`.
   */
  rootKey(): RootKey | undefined {
    return this.#root;
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

  #dropToTrust(): void {
    if (this.#toTrust !== undefined) {
      zero(this.#toTrust.rootKeyBytes);
      this.#toTrust = undefined;
    }
  }

  /** Hold the root key in memory and, optionally, offer to trust the device. */
  async #adopt(
    userId: string,
    rootKeyBytes: Uint8Array<ArrayBuffer>,
    offerTrust: boolean,
  ): Promise<void> {
    const root = await importRootKey(rootKeyBytes);
    this.#root = root;
    this.#dropToTrust();
    if (offerTrust && this.#device !== undefined) {
      this.#toTrust = { userId, rootKeyBytes: rootKeyBytes.slice() };
    }
    this.#afterUnlock?.(root);
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
    return this.#device.has(session.userId);
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

  /** Open this device's stored root key, in the vault's own error terms. */
  async #openOnDevice(
    session: AuthSession,
    devicePassphrase: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (
      this.#device === undefined ||
      !(await this.#device.has(session.userId))
    ) {
      throw new VaultError("no_keys_on_device");
    }
    try {
      return await this.#device.open(session.userId, devicePassphrase);
    } catch (error) {
      if (error instanceof DevicePassphraseError) {
        throw new VaultError("wrong_device_passphrase");
      }
      if (error instanceof DeviceLockedOutError) {
        throw new VaultError("device_locked_out");
      }
      if (error instanceof DeviceStoreDamagedError) {
        // An unusable record is removed, so the app stops offering a way to
        // unlock that cannot work. The recovery key still does.
        await this.#device.forget(session.userId);
        throw new VaultError("device_store_damaged");
      }
      throw error;
    }
  }

  async unlock(devicePassphrase: string): Promise<void> {
    const session = await this.#session();
    const rootKeyBytes = await this.#openOnDevice(session, devicePassphrase);
    try {
      await this.#adopt(session.userId, rootKeyBytes, false);
    } finally {
      zero(rootKeyBytes);
    }
  }

  async withRootKeyBytes<T>(
    credential: RootKeyCredential,
    use: (rootKeyBytes: Uint8Array<ArrayBuffer>) => Promise<T>,
  ): Promise<T> {
    const session = await this.#session();
    const unlocked = this.#root;
    if (unlocked === undefined) {
      throw new VaultError("locked");
    }
    const rootKeyBytes =
      credential.kind === "device_passphrase"
        ? await this.#openOnDevice(session, credential.passphrase)
        : (await this.#open(session, credential.recoveryKey)).rootKeyBytes;
    try {
      // The key released is the one this device is unlocked with, never
      // some other key the credential happens to open.
      const same =
        (await fingerprint(await importRootKey(rootKeyBytes))) ===
        (await fingerprint(unlocked));
      if (!same) {
        throw new VaultError("locked");
      }
      return await use(rootKeyBytes);
    } finally {
      zero(rootKeyBytes);
    }
  }

  async acceptRootKey(rootKeyBytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const session = await this.#session();
    // Offered trust, as after a recovery: this device has no stored key yet.
    await this.#adopt(session.userId, rootKeyBytes, true);
  }

  deviceTrustPending(): boolean {
    return this.#toTrust !== undefined;
  }

  async trustThisDevice(devicePassphrase: string): Promise<void> {
    const session = await this.#session();
    const toTrust = this.#toTrust;
    if (this.#device === undefined || toTrust?.userId !== session.userId) {
      throw new VaultError("nothing_to_trust");
    }
    // If saving fails the material is kept, so the user can try again.
    await this.#device.enrol(
      session.userId,
      toTrust.rootKeyBytes,
      devicePassphrase,
    );
    this.#dropToTrust();
  }

  skipDeviceTrust(): void {
    this.#dropToTrust();
  }

  async unlockWithRecoveryKey(recoveryKey: string): Promise<void> {
    const session = await this.#session();
    const { rootKeyBytes } = await this.#open(session, recoveryKey);
    try {
      await this.#adopt(session.userId, rootKeyBytes, true);
    } finally {
      zero(rootKeyBytes);
    }
  }

  async beginRecoveryKeyRotation(currentRecoveryKey: string): Promise<string> {
    const session = await this.#session();
    // Starting a rotation abandons anything prepared earlier, whether or not
    // the current key turns out to be right.
    this.#dropPending();
    const { stored, rootKeyBytes } = await this.#open(
      session,
      currentRecoveryKey,
    );
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
    const saved = await this.#envelopes.write(session, {
      expectedVersion: pending.expectedVersion,
      envelope,
      formatVersion: RECOVERY_FORMAT_VERSION,
      // One-way, so the server learns nothing about the root key from it.
      enrollmentVerifier: await deviceEnrollmentVerifier(
        await importRootKey(pending.rootKeyBytes),
      ),
    });
    if (!saved) {
      this.#dropPending();
      throw new VaultError(conflict);
    }
    // The change is now on the server, so it is no longer pending whatever
    // happens next. A new account is offered device trust. Replacing the
    // recovery key changes nothing about this device, so it is not asked.
    try {
      await this.#adopt(
        session.userId,
        pending.rootKeyBytes,
        kind === "create",
      );
    } finally {
      this.#dropPending();
    }
  }

  async fingerprint(): Promise<string | undefined> {
    return this.#root === undefined ? undefined : fingerprint(this.#root);
  }

  lock(): void {
    this.#root = undefined;
    this.#dropPending();
    this.#dropToTrust();
  }
}
