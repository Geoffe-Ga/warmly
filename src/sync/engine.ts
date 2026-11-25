/**
 * The sync engine: one cycle of push and then pull, on request (ADR-0006).
 *
 * The engine moves encrypted records between this device's store and the
 * server and keeps a status that is safe to show: a state and a count,
 * never anything a record says (PRD SYNC-010). Repeating a cycle is always
 * safe. This is network retry only: nothing here calls AI.
 *
 * Order comes from the server's revisions and sequence numbers alone. The
 * engine never reads a clock, so a device whose clock is wrong syncs like
 * any other (PRD SYNC-011).
 */
import { ApiError } from "../api/client";
import { MAX_OPERATIONS_PER_BATCH, type OperationResult } from "./protocol";
import type { Acknowledged, PendingChange, SyncSource } from "./source";
import { SyncServerBehindError, SyncUpgradeRequiredError } from "./compat";
import {
  SyncCursorError,
  SyncUnavailableError,
  type SyncTransport,
} from "./transport";

/** Where sync stands, in a form that is safe to show. */
export interface SyncState {
  /**
   * - `synced`: nothing is waiting.
   * - `pending`: changes are waiting to be sent.
   * - `offline`: the server could not be reached; changes are kept here.
   * - `failed`: the server was reached but sync did not finish; changes
   *   are kept here.
   * - `outdated`: this version of the app is too old to sync. Changes are
   *   kept here and the app works as before; syncing starts again once the
   *   app is updated.
   * - `attention`: the server refused a change, or a record was changed in
   *   two places. Nothing was discarded; the person has to decide. This is
   *   shown in preference to `offline` and `failed`, because the person can
   *   act on it without a connection.
   */
  readonly status:
    "synced" | "pending" | "offline" | "failed" | "outdated" | "attention";
  /** How many records have changes the server has not accepted. */
  readonly waiting: number;
}

/**
 * How the last cycle ended, for deciding when to run the next one.
 *
 * - `done`: it finished.
 * - `offline`: the server could not be reached. Worth trying again later.
 * - `retry`: the server failed or was busy. Worth trying again later.
 * - `stopped`: it cannot work until something changes, for example the
 *   person signs in again. Trying again on a timer would not help.
 * - `outdated`: this build is too old for the server. Only updating the
 *   app helps, so nothing is retried.
 * - `unavailable`: this device has nothing to sync with yet: it is not
 *   signed in and registered, or the build has no server. Nothing failed.
 * - `busy`: another tab is syncing this account right now.
 */
export type CycleOutcome =
  | "done"
  | "offline"
  | "retry"
  | "stopped"
  | "outdated"
  | "unavailable"
  | "busy";

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
   * Run one cycle now: send what is waiting, then fetch what changed. A
   * call made while a cycle is running joins it.
   *
   * @returns The state afterwards. It never rejects.
   */
  sync(): Promise<SyncState>;
  /** Start syncing without being asked. Called when the app unlocks. */
  start(): void;
  /** Stop, and forget everything held in memory. Called when the app locks. */
  reset(): void;
}

/**
 * Runs work that only one tab at a time may do.
 *
 * @returns What the work returned, or `undefined` if another tab is doing
 *   it and the work was not run.
 */
export type Exclusive = <T>(work: () => Promise<T>) => Promise<T | undefined>;

const SYNCED: SyncState = { status: "synced", waiting: 0 };

/**
 * How often one push sends again after settling an earlier attempt. Anything
 * still waiting after that stays queued, and the next cycle sends it.
 */
const MAX_PUSH_PASSES = 5;

/** What the server's answer settles, if it accepted the change. */
function accepted(
  change: PendingChange,
  result: OperationResult,
): { revision: number; acknowledged: Acknowledged } | undefined {
  if (result.status === "applied" && result.revision !== undefined) {
    return { revision: result.revision, acknowledged: "current" };
  }
  if (result.status === "duplicate" && result.revision !== undefined) {
    // An earlier attempt got through. What the server holds is the record
    // as it was then.
    return { revision: result.revision, acknowledged: "earlier" };
  }
  // The record is deleted on the server, which is what this device asked.
  return result.status === "deleted" &&
    change.operation.tombstone &&
    result.currentRevision !== undefined
    ? { revision: result.currentRevision, acknowledged: "current" }
    : undefined;
}

/** Decide what a failed cycle means for the next one. */
function outcomeOf(error: unknown): CycleOutcome {
  if (error instanceof ApiError) {
    if (error.code === "offline") {
      return "offline";
    }
    // "unexpected" is a server that failed or answered badly. Every other
    // code is about this session or device and needs the person.
    return error.code === "unexpected" ? "retry" : "stopped";
  }
  if (error instanceof SyncUpgradeRequiredError) {
    return "outdated";
  }
  if (error instanceof SyncServerBehindError) {
    // The server catches up when its own update finishes.
    return "retry";
  }
  return error instanceof SyncUnavailableError ? "unavailable" : "stopped";
}

/** The sync engine for one unlocked store. */
export class SyncEngine {
  readonly #source: SyncSource;
  readonly #transport: SyncTransport;
  readonly #online: () => boolean;
  readonly #exclusive: Exclusive;
  readonly #listeners = new Set<() => void>();
  #state: SyncState = SYNCED;
  #outcome: CycleOutcome = "done";
  /** Records whose change the server refused. */
  #refused = new Set<string>();
  #running: Promise<SyncState> | undefined;
  /** Changes whenever the engine is reset, so a late cycle is ignored. */
  #generation = 0;

  /**
   * @param source - This device's record store.
   * @param transport - Reaches the server.
   * @param online - Whether the browser reports a connection.
   * @param exclusive - Keeps two tabs from syncing one account at once.
   *   Without it every cycle runs.
   */
  constructor(
    source: SyncSource,
    transport: SyncTransport,
    online: () => boolean = () => navigator.onLine,
    exclusive: Exclusive = (work) => work(),
  ) {
    this.#source = source;
    this.#transport = transport;
    this.#online = online;
    this.#exclusive = exclusive;
    // A local change alters how much is waiting, with no network involved.
    source.subscribe(() => {
      void this.#recount();
    });
  }

  /** @returns The current state. */
  state(): SyncState {
    return this.#state;
  }

  /** @returns How the last cycle ended. */
  outcome(): CycleOutcome {
    return this.#outcome;
  }

  /**
   * Be told when the state changes.
   *
   * @returns A function that stops the listener being called.
   */
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

  /** What is waiting and whether anything needs the person, read afresh. */
  async #counts(): Promise<{ waiting: number; attention: boolean }> {
    const [waiting, parked] = await Promise.all([
      this.#source.pendingCount().catch(() => 0),
      this.#source.parkedCount().catch(() => 0),
    ]);
    if (waiting === 0) {
      // Nothing is waiting, so nothing can still be refused: the person
      // settled it another way, for example by keeping the server's version.
      this.#refused = new Set();
    }
    return { waiting, attention: parked > 0 || this.#refused.size > 0 };
  }

  /** Count what is waiting again, keeping what is known about the network. */
  async #recount(): Promise<void> {
    const generation = this.#generation;
    const { waiting, attention } = await this.#counts();
    if (generation !== this.#generation) {
      return;
    }
    const { status } = this.#state;
    if (attention) {
      this.#set({ status: "attention", waiting });
    } else if (
      status === "offline" ||
      status === "failed" ||
      status === "outdated"
    ) {
      this.#set({ status, waiting });
    } else {
      this.#set({ status: waiting > 0 ? "pending" : "synced", waiting });
    }
  }

  /**
   * Run one cycle: send what is waiting, then fetch what changed. A call
   * made while a cycle is running joins it.
   *
   * @returns The state afterwards. It never rejects.
   */
  sync(): Promise<SyncState> {
    this.#running ??= this.#cycle().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  /** Forget everything held in memory. Called when the app locks. */
  reset(): void {
    this.#generation += 1;
    this.#refused = new Set();
    this.#outcome = "done";
    this.#set(SYNCED);
  }

  /** Send one pass of pending changes. @returns Whether to send again. */
  async #pushOnce(): Promise<boolean> {
    const pending = await this.#source.pending();
    // A refused record that is no longer waiting was settled some other
    // way, for example by the person keeping the server's version.
    const waiting = new Set(pending.map((change) => change.operation.recordId));
    this.#refused = new Set(
      [...this.#refused].filter((recordId) => waiting.has(recordId)),
    );
    let again = false;
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
        const answer =
          result === undefined ? undefined : accepted(change, result);
        const { recordId } = change.operation;
        if (answer === undefined) {
          this.#refused.add(recordId);
          continue;
        }
        this.#refused.delete(recordId);
        await this.#source.acknowledge(
          change,
          answer.revision,
          answer.acknowledged,
        );
        // Changes made after the attempt that got through still have to
        // be sent, now on top of what the server holds.
        again ||=
          answer.acknowledged === "earlier" && change.first < change.upTo;
      }
    }
    return again;
  }

  async #push(): Promise<void> {
    for (let pass = 0; pass < MAX_PUSH_PASSES; pass += 1) {
      if (!(await this.#pushOnce())) {
        return;
      }
    }
  }

  async #pull(): Promise<void> {
    let cursor = await this.#source.cursor();
    let restarted = false;
    for (;;) {
      let page;
      try {
        page = await this.#transport.pull(cursor);
      } catch (error) {
        if (!(error instanceof SyncCursorError) || restarted) {
          throw error;
        }
        // The server does not know this cursor. Read the feed again from
        // the start, once: every record comes as it is now.
        restarted = true;
        await this.#source.forgetCursor();
        cursor = "0";
        continue;
      }
      await this.#source.applyPage(page.changes, page.nextCursor);
      // A page that says there is more but does not move on would never
      // end. Stop, and start from here next time.
      const stuck = page.hasMore && page.nextCursor === cursor;
      cursor = page.nextCursor;
      if (!page.hasMore || stuck) {
        return;
      }
    }
  }

  /** Push and pull, unless another tab is already doing it. */
  async #attempt(): Promise<CycleOutcome> {
    if (!this.#online()) {
      return "offline";
    }
    try {
      const ran = await this.#exclusive(async () => {
        await this.#push();
        await this.#pull();
        return true;
      });
      return ran === undefined ? "busy" : "done";
    } catch (error) {
      // Whatever went wrong, the changes are still queued on this device
      // and a later cycle sends them again.
      return outcomeOf(error);
    }
  }

  async #cycle(): Promise<SyncState> {
    const generation = this.#generation;
    const outcome = await this.#attempt();
    const { waiting, attention } = await this.#counts();
    if (generation !== this.#generation) {
      // The app locked while this cycle ran.
      return this.#state;
    }
    this.#outcome = outcome;
    if (attention) {
      // Shown whatever the network is doing: choosing between two versions
      // needs no connection, and the person should not have to wait for one.
      this.#set({ status: "attention", waiting });
    } else if (outcome === "offline") {
      this.#set({ status: "offline", waiting });
    } else if (outcome === "outdated") {
      this.#set({ status: "outdated", waiting });
    } else if (outcome === "retry" || outcome === "stopped") {
      this.#set({ status: "failed", waiting });
    } else {
      this.#set({ status: waiting > 0 ? "pending" : "synced", waiting });
    }
    return this.#state;
  }
}
