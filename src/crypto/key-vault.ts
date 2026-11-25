/**
 * The key-management seam. Screens depend on this interface only, so the real
 * vault (`account-vault.ts`), the screen-test double and the "unavailable"
 * stand-in are interchangeable.
 *
 * The vault holds the account root key. Nothing here involves the account
 * password, which never derives or unlocks a key (PRD SEC-003, DEV-006).
 */

/** Why a vault operation failed. */
export type VaultErrorCode =
  | "wrong_recovery_key"
  | "recovery_key_mistyped"
  | "recovery_key_malformed"
  | "no_keys_on_device"
  | "wrong_device_passphrase"
  | "device_store_damaged"
  | "nothing_to_trust"
  | "no_account_keys"
  | "keys_already_exist"
  | "recovery_key_changed_elsewhere"
  | "nothing_to_confirm"
  | "signed_out"
  | "offline"
  | "unavailable";

/** A failed vault operation, with a code the UI can explain. */
export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode) {
    super(`Key vault operation failed: ${code}`);
    this.name = "VaultError";
    this.code = code;
  }
}

/** Creates, unlocks and locks the account root key. */
export interface KeyVault {
  /** Whether this device can unlock without the recovery key. */
  hasKeysOnThisDevice(): Promise<boolean>;
  /** Whether the account has finished creating its keys, on any device. */
  accountHasKeys(): Promise<boolean>;
  /**
   * Prepare the account's keys during onboarding. Nothing is saved yet: the
   * keys take effect only when {@link confirmRecoveryKey} is called, so a
   * user can never be left with keys whose recovery key they did not see.
   *
   * @returns The recovery key, to show to the user exactly once.
   */
  createAccountKeys(): Promise<string>;
  /**
   * Save the keys prepared by {@link createAccountKeys}, once the user has
   * confirmed they stored the recovery key. Unlocks the vault.
   *
   * @throws VaultError `nothing_to_confirm` or `keys_already_exist`.
   */
  confirmRecoveryKey(): Promise<void>;
  /**
   * Unlock using this trusted device's stored key and its passphrase.
   *
   * @throws VaultError `no_keys_on_device`, `wrong_device_passphrase` or
   *   `device_store_damaged`.
   */
  unlock(devicePassphrase: string): Promise<void>;
  /**
   * Whether the vault has just been opened with the recovery key and can
   * make this device trusted. True only until the user decides.
   */
  deviceTrustPending(): boolean;
  /**
   * Make this device trusted: from now on it unlocks with this passphrase
   * instead of the recovery key.
   *
   * @throws VaultError `nothing_to_trust`.
   */
  trustThisDevice(devicePassphrase: string): Promise<void>;
  /** Decline to trust this device. It will need the recovery key each time. */
  skipDeviceTrust(): void;
  /**
   * Unlock on a device that has no stored key.
   *
   * @throws VaultError `recovery_key_malformed`, `recovery_key_mistyped`,
   *   `wrong_recovery_key` or `no_account_keys`.
   */
  unlockWithRecoveryKey(recoveryKey: string): Promise<void>;
  /**
   * Start replacing the recovery key. The current key is checked and a new
   * one prepared, but the old key keeps working until
   * {@link confirmRecoveryKeyRotation} succeeds.
   *
   * @returns The new recovery key, to show to the user exactly once.
   * @throws VaultError as for {@link unlockWithRecoveryKey}.
   */
  beginRecoveryKeyRotation(currentRecoveryKey: string): Promise<string>;
  /**
   * Make the new recovery key the only one that works.
   *
   * @throws VaultError `nothing_to_confirm`, or
   *   `recovery_key_changed_elsewhere` if another device replaced it first.
   */
  confirmRecoveryKeyRotation(): Promise<void>;
  /**
   * A short public label for the unlocked account key, for checking that two
   * devices hold the same one. It reveals nothing about the key.
   *
   * @returns The fingerprint, or `undefined` while locked.
   */
  fingerprint(): Promise<string | undefined>;
  /** Drop decrypted key material and anything unconfirmed from memory. */
  lock(): void;
}

/**
 * Stand-in used by production builds that are not configured with a backend.
 * Nothing can be created or unlocked, and the app says so.
 */
export class UnavailableKeyVault implements KeyVault {
  hasKeysOnThisDevice(): Promise<boolean> {
    return Promise.resolve(false);
  }

  accountHasKeys(): Promise<boolean> {
    return Promise.reject(new VaultError("unavailable"));
  }

  createAccountKeys(): Promise<string> {
    return Promise.reject(new VaultError("unavailable"));
  }

  confirmRecoveryKey(): Promise<void> {
    return Promise.reject(new VaultError("unavailable"));
  }

  unlock(): Promise<void> {
    return Promise.reject(new VaultError("unavailable"));
  }

  deviceTrustPending(): boolean {
    return false;
  }

  trustThisDevice(): Promise<void> {
    return Promise.reject(new VaultError("unavailable"));
  }

  skipDeviceTrust(): void {
    // Nothing is ever pending.
  }

  unlockWithRecoveryKey(): Promise<void> {
    return Promise.reject(new VaultError("unavailable"));
  }

  beginRecoveryKeyRotation(): Promise<string> {
    return Promise.reject(new VaultError("unavailable"));
  }

  confirmRecoveryKeyRotation(): Promise<void> {
    return Promise.reject(new VaultError("unavailable"));
  }

  fingerprint(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  lock(): void {
    // Nothing is ever held, so there is nothing to drop.
  }
}
