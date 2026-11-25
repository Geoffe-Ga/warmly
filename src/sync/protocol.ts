/**
 * The sync protocol's messages, as the client holds them (ADR-0006).
 *
 * These mirror the API's wire models, with payloads as bytes. A payload is
 * always an ADR-0003 envelope: ciphertext the server cannot read.
 */

/** What the server did with an operation. */
export type OperationStatus =
  "applied" | "duplicate" | "conflict" | "deleted" | "rejected";

/** One change to a record, sent to the server. */
export interface SyncOperation {
  /** A fresh UUID, so the server can recognise a repeat. */
  readonly opId: string;
  readonly recordId: string;
  /** The record's type number; the server never interprets it. */
  readonly type: number;
  /** The server revision the change was made on top of; 0 for a new record. */
  readonly baseRevision: number;
  readonly schemaVersion: number;
  /** Whether this operation deletes the record. */
  readonly tombstone: boolean;
  /** The encrypted record; `null` exactly when `tombstone` is true. */
  readonly payload: Uint8Array<ArrayBuffer> | null;
}

/** The server's answer to one operation. */
export interface OperationResult {
  readonly opId: string;
  readonly status: OperationStatus;
  /** The record's revision after an `applied` or `duplicate` operation. */
  readonly revision?: number;
  /** The record's revision when the operation was refused. */
  readonly currentRevision?: number;
}

/** The current state of a record that changed after a cursor. */
export interface RemoteChange {
  readonly recordId: string;
  readonly type: number;
  readonly revision: number;
  /** The record's place in the owner's change feed. */
  readonly sequence: number;
  readonly schemaVersion: number;
  readonly tombstone: boolean;
  readonly payload: Uint8Array<ArrayBuffer> | null;
}

/** One page of the change feed. */
export interface ChangePage {
  readonly changes: readonly RemoteChange[];
  /** The cursor to send next. */
  readonly nextCursor: string;
  readonly hasMore: boolean;
}

/** The most operations one request may carry. */
export const MAX_OPERATIONS_PER_BATCH = 100;
