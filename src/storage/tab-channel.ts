/**
 * How tabs of one account tell each other that a stored record changed
 * (ADR-0017).
 *
 * Only one thing is ever said: {@link TAB_CHANGED}. It names no record and
 * holds nothing the person wrote. A tab that hears it reads what changed
 * from the database, so a message can prompt a read and nothing else.
 */

/** The one message tabs send each other. */
export const TAB_CHANGED = "changed";

/** A way to reach the other tabs that have the same database open. */
export interface TabChannel {
  /** Tell the other tabs. This tab does not hear its own message. */
  post(message: unknown): void;
  /** Be told what the other tabs post. */
  listen(listener: (message: unknown) => void): void;
  /** Stop listening and let the channel go. */
  close(): void;
}

/** Opens the channel for a database, or nothing where there is no way. */
export type TabChannelFactory = (name: string) => TabChannel | undefined;

/**
 * The browser's own channel between tabs of this origin.
 *
 * @param name - The channel's name: the account's database name.
 * @returns The channel, or `undefined` in a browser without
 *   `BroadcastChannel`. Tabs then learn of each other's changes as they
 *   did before: when a write is refused, or on the next unlock.
 */
export function browserTabChannel(name: string): TabChannel | undefined {
  if (typeof BroadcastChannel === "undefined") {
    return undefined;
  }
  const channel = new BroadcastChannel(name);
  return {
    post: (message) => {
      channel.postMessage(message);
    },
    listen: (listener) => {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        listener(event.data);
      };
    },
    close: () => {
      channel.onmessage = null;
      channel.close();
    },
  };
}

/**
 * Whether a tab's memory already holds a stored row as it is now, so that
 * the row need not be read again.
 *
 * @param held - The copy in memory, if there is one, with the local
 *   revision it was read or stored at.
 * @param unreadable - Whether memory marks the row as one it cannot read.
 * @param row - The row as stored.
 * @returns `true` if there is nothing to take in.
 */
export function holdsCurrent(
  held: { readonly revision: number } | undefined,
  unreadable: boolean,
  row: { readonly localRevision: number; readonly tombstone: boolean },
): boolean {
  if (row.tombstone) {
    // A deleted record never comes back, so nothing of it may be held.
    return held === undefined && !unreadable;
  }
  // A local revision only ever goes up. A copy at a higher one than the
  // row is a change this tab stored after the rows were read: the newer.
  return held !== undefined && held.revision >= row.localRevision;
}
