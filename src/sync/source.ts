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
  /** The newest outbox position this operation covers. */
  readonly upTo: number;
  /** The record's local revision when the operation was built. */
  readonly localRevision: number;
}

/** What happened when a change from the server met the local record. */
export type RemoteOutcome =
  /** The local record was replaced by the server's. */
  | "applied"
  /** The local record was already at least that new. */
  | "unchanged"
  /**
   * The local record has changes of its own, or is deleted here. Nothing
   * was replaced: both versions are kept for the person to resolve.
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
   */
  acknowledge(change: PendingChange, serverRevision: number): Promise<void>;
  /**
   * Bring a change from the server into the store.
   *
   * @param change - The record's current state on the server.
   * @returns What was done with it.
   */
  applyRemote(change: RemoteChange): Promise<RemoteOutcome>;
  /** @returns How many records have unsent changes. 0 while locked. */
  pendingCount(): Promise<number>;
  /**
   * Be told after any record changes.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
}
