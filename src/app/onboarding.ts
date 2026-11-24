/**
 * State that exists only while an account is being set up.
 *
 * It holds the recovery key between its creation and the user confirming they
 * saved it (PRD DEV-006). The key lives in this object, in memory, and nowhere
 * else: it is never written to storage. `clear()` is called when onboarding
 * finishes and whenever the session ends or locks, so the key can never be
 * shown to whoever uses the device next.
 */
export interface Onboarding {
  /** The key to show, if one is waiting to be confirmed. */
  readonly recoveryKey: string | undefined;
  /**
   * Whether the email address has been verified in this onboarding. Kept so a
   * failure after verification can be retried without verifying again.
   */
  readonly emailVerified: boolean;
  /** Record that the email address was verified. */
  markEmailVerified(): void;
  /** Hold a newly created recovery key until it is confirmed. */
  holdRecoveryKey(recoveryKey: string): void;
  /** Forget everything. Safe to call at any time, any number of times. */
  clear(): void;
}

/**
 * Create an empty onboarding state.
 *
 * @returns The onboarding state.
 */
export function createOnboarding(): Onboarding {
  let recoveryKey: string | undefined;
  let emailVerified = false;
  return {
    get recoveryKey() {
      return recoveryKey;
    },
    get emailVerified() {
      return emailVerified;
    },
    markEmailVerified() {
      emailVerified = true;
    },
    holdRecoveryKey(key) {
      recoveryKey = key;
    },
    clear() {
      recoveryKey = undefined;
      emailVerified = false;
    },
  };
}
