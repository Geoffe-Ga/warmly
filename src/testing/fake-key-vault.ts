/**
 * In-memory {@link KeyVault} for screen-level unit tests. It must never be
 * part of a production build.
 *
 * It performs no cryptography, so screen tests stay fast and can assert on a
 * known key. The "recovery key" is a fixed, obviously synthetic string. Two
 * `sessionStorage` entries stand in for the two places real keys live: the
 * account (the server's envelope) and this device. A real recovery key is
 * never stored anywhere.
 */
import { VaultError, type KeyVault } from "../crypto/key-vault";

const DEVICE_SLOT = "warmly.fake.vault";
const ACCOUNT_SLOT = "warmly.fake.vault.account";

/** The recovery key every fake account starts with. */
export const FAKE_RECOVERY_KEY = "FAKE-KEY0-NOT0-REAL-0000-TEST";
/** The recovery key a fake account has after replacing it. */
export const FAKE_ROTATED_RECOVERY_KEY = "FAKE-KEY0-NOT0-REAL-0000-NEXT";

/** See the module comment. */
export class FakeKeyVault implements KeyVault {
  readonly #storage: Storage;
  #unlocked = false;
  #pending: string | undefined;

  constructor(storage: Storage = sessionStorage) {
    this.#storage = storage;
  }

  /** Whether key material is currently "in memory". Test-only inspection. */
  get isUnlocked(): boolean {
    return this.#unlocked;
  }

  #accountKey(): string | null {
    return this.#storage.getItem(ACCOUNT_SLOT);
  }

  #check(recoveryKey: string): void {
    const current = this.#accountKey();
    if (current === null) {
      throw new VaultError("no_account_keys");
    }
    if (normaliseRecoveryKey(recoveryKey) !== current) {
      throw new VaultError("wrong_recovery_key");
    }
  }

  /** Make this "device" forget its key, as a new device would. Test-only. */
  forgetThisDevice(): void {
    this.#storage.removeItem(DEVICE_SLOT);
    this.#unlocked = false;
  }

  hasKeysOnThisDevice(): Promise<boolean> {
    return Promise.resolve(this.#storage.getItem(DEVICE_SLOT) !== null);
  }

  accountHasKeys(): Promise<boolean> {
    return Promise.resolve(this.#accountKey() !== null);
  }

  createAccountKeys(): Promise<string> {
    this.#pending = FAKE_RECOVERY_KEY;
    return Promise.resolve(FAKE_RECOVERY_KEY);
  }

  confirmRecoveryKey(): Promise<void> {
    return this.#confirm(FAKE_RECOVERY_KEY);
  }

  unlock(): Promise<void> {
    if (this.#storage.getItem(DEVICE_SLOT) === null) {
      return Promise.reject(new VaultError("no_keys_on_device"));
    }
    this.#unlocked = true;
    return Promise.resolve();
  }

  unlockWithRecoveryKey(recoveryKey: string): Promise<void> {
    try {
      this.#check(recoveryKey);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    this.#storage.setItem(DEVICE_SLOT, "trusted");
    this.#unlocked = true;
    return Promise.resolve();
  }

  beginRecoveryKeyRotation(currentRecoveryKey: string): Promise<string> {
    try {
      this.#check(currentRecoveryKey);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    this.#pending = FAKE_ROTATED_RECOVERY_KEY;
    return Promise.resolve(FAKE_ROTATED_RECOVERY_KEY);
  }

  confirmRecoveryKeyRotation(): Promise<void> {
    return this.#confirm(FAKE_ROTATED_RECOVERY_KEY);
  }

  #confirm(expected: string): Promise<void> {
    if (this.#pending !== expected) {
      return Promise.reject(new VaultError("nothing_to_confirm"));
    }
    this.#storage.setItem(ACCOUNT_SLOT, expected);
    this.#storage.setItem(DEVICE_SLOT, "trusted");
    this.#pending = undefined;
    this.#unlocked = true;
    return Promise.resolve();
  }

  fingerprint(): Promise<string | undefined> {
    return Promise.resolve(this.#unlocked ? "fa4efa4efa4efa4e" : undefined);
  }

  lock(): void {
    this.#unlocked = false;
    this.#pending = undefined;
  }
}

/**
 * Tidy a typed fake recovery key: upper case, with spaces removed.
 *
 * @param typed - What the user entered.
 * @returns The key in its canonical form.
 */
export function normaliseRecoveryKey(typed: string): string {
  return typed.replace(/\s+/g, "").toUpperCase();
}
