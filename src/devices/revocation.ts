/**
 * How the app learns that this device has been revoked (PRD DEV-003,
 * DEV-004; AC-20).
 *
 * The server refuses a revoked device with `device.revoked`. That can arrive
 * on any request, from any screen, so it is reported here in one place and
 * handled once by the app shell, which drops the keys and signs out.
 */

/** Carries the news that this device was revoked to whoever must act on it. */
export interface RevocationSignal {
  /** Say that the server has refused this device as revoked. */
  report(): void;
  /**
   * Be told when this device is revoked.
   *
   * @param listener - Called once per report.
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * Make a signal with no listeners.
 *
 * @returns The signal.
 */
export function createRevocationSignal(): RevocationSignal {
  const listeners = new Set<() => void>();
  return {
    report: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
