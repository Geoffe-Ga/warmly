/**
 * The key-management seam. Screens depend on this interface only, so the real
 * cryptography (issues #17, #19 and #20) replaces the stand-ins without
 * touching any screen.
 *
 * The vault holds the account root key. Nothing here involves the account
 * password, which never derives or unlocks a key (PRD SEC-003, DEV-006).
 */

/** Why a vault operation failed. */
export type VaultErrorCode =
  "wrong_recovery_key" | "no_keys_on_device" | "unavailable";

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
  /**
   * Create the account's keys during onboarding.
   *
   * @returns The recovery key, to show to the user exactly once.
   */
  createAccountKeys(): Promise<string>;
  /**
   * Unlock using this trusted device's stored key.
   *
   * @throws VaultError `no_keys_on_device`.
   */
  unlock(): Promise<void>;
  /**
   * Unlock on a device that has no stored key.
   *
   * @throws VaultError `wrong_recovery_key`.
   */
  unlockWithRecoveryKey(recoveryKey: string): Promise<void>;
  /** Drop decrypted key material from memory. */
  lock(): void;
}

/**
 * Stand-in used by production builds until the real vault exists. Nothing can
 * be created or unlocked, and the app says so.
 */
export class UnavailableKeyVault implements KeyVault {
  hasKeysOnThisDevice(): Promise<boolean> {
    return Promise.resolve(false);
  }

  createAccountKeys(): Promise<string> {
    return Promise.reject(new VaultError("unavailable"));
  }

  unlock(): Promise<void> {
    return Promise.reject(new VaultError("unavailable"));
  }

  unlockWithRecoveryKey(): Promise<void> {
    return Promise.reject(new VaultError("unavailable"));
  }

  lock(): void {
    // Nothing is ever held, so there is nothing to drop.
  }
}
