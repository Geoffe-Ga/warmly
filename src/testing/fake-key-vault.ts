/**
 * In-memory {@link KeyVault} for development, unit tests and the `e2e` build.
 * It must never be part of a production build.
 *
 * It performs no cryptography. The "recovery key" is a fixed, obviously
 * synthetic string, and it is kept in `sessionStorage` only so a reload
 * behaves like a trusted device. A real recovery key is never stored anywhere.
 */
import { VaultError, type KeyVault } from "../crypto/key-vault";

const STORAGE_KEY = "warmly.fake.vault";

/** The recovery key every fake account gets. */
export const FAKE_RECOVERY_KEY = "FAKE-KEY0-NOT0-REAL-0000-TEST";

/** See the module comment. */
export class FakeKeyVault implements KeyVault {
  readonly #storage: Storage;
  #unlocked = false;

  constructor(storage: Storage = sessionStorage) {
    this.#storage = storage;
  }

  /** Whether key material is currently "in memory". Test-only inspection. */
  get isUnlocked(): boolean {
    return this.#unlocked;
  }

  hasKeysOnThisDevice(): Promise<boolean> {
    return Promise.resolve(this.#storage.getItem(STORAGE_KEY) !== null);
  }

  createAccountKeys(): Promise<string> {
    this.#storage.setItem(STORAGE_KEY, FAKE_RECOVERY_KEY);
    this.#unlocked = true;
    return Promise.resolve(FAKE_RECOVERY_KEY);
  }

  unlock(): Promise<void> {
    if (this.#storage.getItem(STORAGE_KEY) === null) {
      return Promise.reject(new VaultError("no_keys_on_device"));
    }
    this.#unlocked = true;
    return Promise.resolve();
  }

  unlockWithRecoveryKey(recoveryKey: string): Promise<void> {
    if (normaliseRecoveryKey(recoveryKey) !== FAKE_RECOVERY_KEY) {
      return Promise.reject(new VaultError("wrong_recovery_key"));
    }
    this.#storage.setItem(STORAGE_KEY, FAKE_RECOVERY_KEY);
    this.#unlocked = true;
    return Promise.resolve();
  }

  lock(): void {
    this.#unlocked = false;
  }
}

/**
 * Tidy a typed recovery key: upper case, with spaces removed.
 *
 * @param typed - What the user entered.
 * @returns The key in its canonical form.
 */
export function normaliseRecoveryKey(typed: string): string {
  return typed.replace(/\s+/g, "").toUpperCase();
}
