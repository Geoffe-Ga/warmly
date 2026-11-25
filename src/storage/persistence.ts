/**
 * Asking the browser to keep this device's data (PRD SYNC-001, AC-28).
 *
 * By default a browser may clear a site's stored data when the device runs
 * short of space or the site has not been opened for a while. A site can ask
 * for its storage to be "persistent", which the browser may or may not
 * grant. The app asks, and tells the person the answer as it is.
 */

/** Whether the browser has agreed to keep the app's data. */
export type Persistence =
  /** The browser will not clear the data to make room. */
  | "persistent"
  /** The browser may clear the data when it needs space. */
  | "best-effort"
  /** The browser has no way to ask or to tell. */
  | "unsupported";

/** Asks for, and reports on, persistent storage. */
export interface StoragePersistence {
  /**
   * Ask the browser to keep the data. Asking again is harmless.
   *
   * @returns What the browser decided.
   */
  request(): Promise<Persistence>;
  /**
   * Find out, without asking for anything.
   *
   * @returns Whether the data is being kept.
   */
  state(): Promise<Persistence>;
}

/** The part of `navigator.storage` this needs. Either method may be missing. */
export type PersistentStorage = Partial<
  Pick<StorageManager, "persist" | "persisted">
>;

/**
 * Persistent storage as this browser offers it.
 *
 * @param storage - The browser's storage manager; `undefined` where there
 *   is none, as on an insecure page.
 * @returns The persistence service. It never rejects: a browser that fails
 *   to answer is reported as "unsupported".
 */
export function browserPersistence(
  storage: PersistentStorage | undefined,
): StoragePersistence {
  const ask = async (method: "persist" | "persisted"): Promise<Persistence> => {
    const answer = storage?.[method];
    if (answer === undefined) {
      return "unsupported";
    }
    try {
      return (await answer.call(storage)) ? "persistent" : "best-effort";
    } catch {
      return "unsupported";
    }
  };
  return {
    request: () => ask("persist"),
    state: () => ask("persisted"),
  };
}
