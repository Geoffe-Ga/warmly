/**
 * Work that must finish before the app locks (PRD DEV-005).
 *
 * Locking drops the keys from memory. Anything that still needs them, such as
 * encrypting and saving the draft being edited, registers a hook here and is
 * given the chance to finish first, so locking never loses unsaved work.
 */

/** How long locking waits for the hooks before going ahead without them. */
export const FLUSH_TIMEOUT_MS = 5_000;

/** Saves whatever needs the keys. Called just before they are dropped. */
export type FlushHook = () => Promise<void>;

/** The hooks to run before locking. */
export interface LockHooks {
  /**
   * Add a hook.
   *
   * @param hook - The work to finish before a lock.
   * @returns A function that removes the hook again.
   */
  register(hook: FlushHook): () => void;
  /**
   * Run every hook and wait for them, up to the timeout. A hook that fails
   * or hangs does not stop the lock: leaving the app unlocked would be the
   * worse outcome.
   *
   * @param timeoutMs - The longest to wait.
   * @returns How many hooks failed or did not finish in time.
   */
  flush(timeoutMs?: number): Promise<number>;
}

/**
 * Create an empty set of lock hooks.
 *
 * @returns The hooks.
 */
export function createLockHooks(): LockHooks {
  const hooks = new Set<FlushHook>();
  return {
    register(hook) {
      hooks.add(hook);
      return () => {
        hooks.delete(hook);
      };
    },
    async flush(timeoutMs = FLUSH_TIMEOUT_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          resolve("timeout");
        }, timeoutMs);
      });
      const outcomes = await Promise.all(
        [...hooks].map((hook) =>
          Promise.race([
            // Started inside a promise so a hook that throws synchronously
            // is counted as failed, not thrown out of the lock.
            Promise.resolve()
              .then(hook)
              .then(
                () => "done" as const,
                () => "failed" as const,
              ),
            timedOut,
          ]),
        ),
      );
      clearTimeout(timer);
      return outcomes.filter((outcome) => outcome !== "done").length;
    },
  };
}
