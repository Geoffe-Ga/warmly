/**
 * The outbox: every change made on this device, queued for sync in the
 * order it was made (PRD SYNC-001, SYNC-002; ADR-0014).
 *
 * An operation is written in the same transaction as the record it
 * describes, so the queue can never disagree with the data. Nothing here
 * sends anything: the sync engine reads the queue and empties it.
 */
import { OUTBOX, transact } from "./db";

/** One queued change. It names a record; it never holds its content. */
export interface OutboxOperation {
  /** Position in the queue, assigned by the database. */
  readonly seq: number;
  /** A fresh random UUID, so the server can recognise a retry. */
  readonly opId: string;
  readonly type: number;
  readonly id: string;
  /** The record's local revision after this change. */
  readonly localRevision: number;
  /** The server revision the change was made on top of. */
  readonly baseRevision: number;
  readonly schemaVersion: number;
  /** Whether this change deletes the record. */
  readonly tombstone: boolean;
}

/** An operation before the database has given it a place in the queue. */
export type NewOutboxOperation = Omit<OutboxOperation, "seq">;

/**
 * Add an operation to the queue, inside a transaction the caller owns.
 *
 * @param transaction - A read-write transaction that includes the outbox.
 * @param operation - The change to queue.
 */
export function queueOperation(
  transaction: IDBTransaction,
  operation: NewOutboxOperation,
): void {
  transaction.objectStore(OUTBOX).add(operation);
}

/**
 * Read the queue, oldest first.
 *
 * @param database - The open database.
 * @returns Every queued operation.
 */
export function readOutbox(database: IDBDatabase): Promise<OutboxOperation[]> {
  return transact<OutboxOperation[]>(
    database,
    [OUTBOX],
    "readonly",
    (transaction, result) => {
      const reading = transaction.objectStore(OUTBOX).getAll();
      reading.onsuccess = () => {
        result(reading.result as OutboxOperation[]);
      };
    },
  );
}
