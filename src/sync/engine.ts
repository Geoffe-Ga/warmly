/**
 * The sync engine: one push and then one pull, on request (ADR-0006).
 *
 * The engine moves encrypted records between this device's store and the
 * server and keeps a status that is safe to show: a state and a count,
 * never anything a record says (PRD SYNC-010). Repeating a cycle is always
 * safe. This is network retry only: nothing here calls AI.
 */
import { ApiError } from "../api/client";
import { MAX_OPERATIONS_PER_BATCH, type OperationResult } from "./protocol";
import type { PendingChange, SyncSource } from "./source";
import type { SyncTransport } from "./transport";

/** Where sync stands, in a form that is safe to show. */
export interface SyncState {
  /**
   * - `synced`: nothing is waiting.
   * - `pending`: changes are waiting to be sent.
   * - `offline`: the server could not be reached; changes are kept here.
   * - `attention`: the server refused a change, or a record was changed in
   *   two places. Nothing was discarded; the person has to decide.
   */
  readonly status: "synced" | "pending" | "offline" | "attention";
  /** How many records have changes the server has not accepted. */
  readonly waiting: number;
}

/** What the app uses to run sync and show its status. */
export interface SyncControl {
  /** @returns The current state. */
  state(): SyncState;
  /**
   * Be told when the state changes.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Run one cycle: send what is waiting, then fetch what changed. A call
   * made while a cycle is running joins it.
   *
   * @returns The state afterwards. It never rejects.
   */
  sync(): Promise<SyncState>;
  /** Forget everything held in memory. Called when the app locks. */
  reset(): void;
}

const SYNCED: SyncState = { status: "synced", waiting: 0 };

/** Whether the server accepted the change an operation carried. */
function accepted(
  change: PendingChange,
  result: OperationResult,
): number | undefined {
  if (result.status === "applied" || result.status === "duplicate") {
    return result.revision;
  }
  // The record is deleted on the server, which is what this device asked.
  return result.status === "deleted" && change.operation.tombstone
    ? result.currentRevision
    : undefined;
}

/** The sync engine for one unlocked store. */
export class SyncEngine implements SyncControl {
  readonly #source: SyncSource;
  readonly #transport: SyncTransport;
  readonly #online: () => boolean;
  readonly #listeners = new Set<() => void>();
  #state: SyncState = SYNCED;
  #cursor = "0";
  /** Records the server refused or that changed in two places. */
  #attention = new Set<string>();
  #running: Promise<SyncState> | undefined;
  /** Changes whenever the engine is reset, so a late cycle is ignored. */
  #generation = 0;

  /**
   * @param source - This device's record store.
   * @param transport - Reaches the server.
   * @param online - Whether the browser reports a connection.
   */
  constructor(
    source: SyncSource,
    transport: SyncTransport,
    online: () => boolean = () => navigator.onLine,
  ) {
    this.#source = source;
    this.#transport = transport;
    this.#online = online;
    // A local change alters how much is waiting, with no network involved.
    source.subscribe(() => {
      void this.#recount();
    });
  }

  state(): SyncState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #set(state: SyncState): void {
    if (
      state.status !== this.#state.status ||
      state.waiting !== this.#state.waiting
    ) {
      this.#state = state;
      for (const listener of [...this.#listeners]) {
        listener();
      }
    }
  }

  /** Count what is waiting again, keeping what is known about the network. */
  async #recount(): Promise<void> {
    const generation = this.#generation;
    const waiting = await this.#source.pendingCount().catch(() => 0);
    if (generation !== this.#generation) {
      return;
    }
    const { status } = this.#state;
    if (status === "offline" || status === "attention") {
      this.#set({ status, waiting });
    } else {
      this.#set({ status: waiting > 0 ? "pending" : "synced", waiting });
    }
  }

  sync(): Promise<SyncState> {
    this.#running ??= this.#cycle().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  reset(): void {
    this.#generation += 1;
    this.#cursor = "0";
    this.#attention = new Set();
    this.#set(SYNCED);
  }

  async #push(): Promise<void> {
    const pending = await this.#source.pending();
    for (
      let start = 0;
      start < pending.length;
      start += MAX_OPERATIONS_PER_BATCH
    ) {
      const batch = pending.slice(start, start + MAX_OPERATIONS_PER_BATCH);
      const results = await this.#transport.push(
        batch.map((change) => change.operation),
      );
      for (const [index, change] of batch.entries()) {
        const result = results[index];
        const revision =
          result === undefined ? undefined : accepted(change, result);
        if (revision === undefined) {
          this.#attention.add(change.operation.recordId);
        } else {
          this.#attention.delete(change.operation.recordId);
          await this.#source.acknowledge(change, revision);
        }
      }
    }
  }

  async #pull(): Promise<void> {
    for (;;) {
      const page = await this.#transport.pull(this.#cursor);
      for (const change of page.changes) {
        const outcome = await this.#source.applyRemote(change);
        if (outcome === "conflict") {
          this.#attention.add(change.recordId);
        }
      }
      // A page that says there is more but does not move on would never
      // end. Stop, and start from here next time.
      const stuck = page.hasMore && page.nextCursor === this.#cursor;
      this.#cursor = page.nextCursor;
      if (!page.hasMore || stuck) {
        return;
      }
    }
  }

  async #cycle(): Promise<SyncState> {
    const generation = this.#generation;
    let reached = false;
    if (this.#online()) {
      try {
        await this.#push();
        await this.#pull();
        reached = true;
      } catch (error) {
        // Whatever went wrong, the changes are still queued on this device
        // and the next cycle sends them again. Only "the server could not
        // be reached" is shown differently.
        reached = !(error instanceof ApiError && error.code === "offline");
      }
    }
    const waiting = await this.#source.pendingCount().catch(() => 0);
    if (generation !== this.#generation) {
      // The app locked while this cycle ran.
      return this.#state;
    }
    if (!reached) {
      this.#set({ status: "offline", waiting });
    } else if (this.#attention.size > 0) {
      this.#set({ status: "attention", waiting });
    } else {
      this.#set({ status: waiting > 0 ? "pending" : "synced", waiting });
    }
    return this.#state;
  }
}
