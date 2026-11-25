/**
 * What the sync engine needs from this device's record store (ADR-0006).
 *
 * The engine never sees a decrypted record. It moves envelopes between the
 * store and the server and tells the store what the server said.
 */
import type { RemoteChange, SyncOperation } from "./protocol";

/** A record with changes the server has not accepted yet. */
export interface PendingChange {
  /** The operation to send: the record as it is now. */
  readonly operation: SyncOperation;
  /** The outbox position of the queued change whose ID the operation uses. */
  readonly first: number;
  /** The newest outbox position this operation covers. */
  readonly upTo: number;
  /** The record's local revision when the operation was built. */
  readonly localRevision: number;
}

/**
 * Which of a record's queued changes the server's answer settles.
 *
 * - `current`: the server holds the record as it was sent just now.
 * - `earlier`: the server had already applied the oldest queued change, on
 *   an attempt whose answer never arrived. What it holds may be older than
 *   the record is now, so anything changed since is still waiting.
 */
export type Acknowledged = "current" | "earlier";

/** What happened when a change from the server met the local record. */
export type RemoteOutcome =
  /** The local record was replaced by the server's. */
  | "applied"
  /** The local record was already at least that new. */
  | "unchanged"
  /**
   * The local record has changes of its own, or is deleted here. Nothing
   * was replaced. When the local record has unsent changes, the server's
   * version is kept beside it for the person to resolve.
   */
  | "conflict";

/** The sync side of a record store. */
export interface SyncSource {
  /**
   * @returns One pending change for each record with unsent changes, oldest
   *   first. Empty while the store is locked.
   */
  pending(): Promise<PendingChange[]>;
  /**
   * Record that the server accepted a pending change.
   *
   * @param change - The change that was sent.
   * @param serverRevision - The record's revision on the server now.
   * @param acknowledged - Which queued changes that settles.
   */
  acknowledge(
    change: PendingChange,
    serverRevision: number,
    acknowledged: Acknowledged,
  ): Promise<void>;
  /**
   * Bring one page of the change feed into the store and move the cursor,
   * in one step: after a crash the device has the whole page and the new
   * cursor, or neither.
   *
   * @param changes - Each record's current state on the server.
   * @param nextCursor - The cursor to ask from next time.
   * @returns What was done with each change, in the same order.
   */
  applyPage(
    changes: readonly RemoteChange[],
    nextCursor: string,
  ): Promise<RemoteOutcome[]>;
  /** @returns This device's place in the change feed; `"0"` to start. */
  cursor(): Promise<string>;
  /** Start the change feed again from the beginning next time. */
  forgetCursor(): Promise<void>;
  /**
   * @returns How many records have a server version kept beside a local
   *   one, waiting for the person to choose. 0 while locked.
   */
  parkedCount(): Promise<number>;
  /** @returns How many records have unsent changes. 0 while locked. */
  pendingCount(): Promise<number>;
  /**
   * Be told after any record changes.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
}
