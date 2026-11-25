/**
 * A new version of the app that is ready to use (PRD §8, REL-004; AC-28).
 *
 * The service worker downloads a new version in the background and then
 * waits: it is never switched to on its own, because the page would reload
 * under whatever the person is writing. This holds the waiting version
 * until the person asks for it. Whoever applies it saves unsaved work first.
 */

/** A new version waiting to be used, and the way to switch to it. */
export interface AppUpdates {
  /** @returns Whether a new version is waiting. */
  available(): boolean;
  /**
   * Be told when a new version starts waiting.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Say that a new version is waiting.
   *
   * @param activate - Switches to it. This reloads the page.
   */
  offer(activate: () => Promise<void>): void;
  /**
   * Switch to the waiting version. Does nothing if there is none. The
   * caller has already saved anything unsaved.
   */
  apply(): Promise<void>;
}

/**
 * Create a holder with no version waiting.
 *
 * @returns The holder.
 */
export function createUpdates(): AppUpdates {
  const listeners = new Set<() => void>();
  let activate: (() => Promise<void>) | undefined;
  return {
    available: () => activate !== undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    offer(switchTo) {
      activate = switchTo;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    async apply() {
      await activate?.();
    },
  };
}

/** The app's own holder: the page entry point offers versions to it. */
export const appUpdates = createUpdates();
