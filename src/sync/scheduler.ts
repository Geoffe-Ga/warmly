/**
 * Decides when the sync engine runs (PRD SYNC-008, SYNC-010; ADR-0006).
 *
 * A cycle runs when the app unlocks, when the network comes back, when the
 * page is shown again, shortly after a local change, and now and then while
 * the page is open. A cycle that could not reach the server, or found it
 * failing, is tried again later: each wait about twice the last, up to a
 * limit, with some randomness so that devices do not all return at once. A
 * retry sends the same operations under the same IDs, so repeating is
 * safe. This is network retry only. Nothing here applies to AI.
 */
import type { CycleOutcome, Exclusive, SyncControl, SyncState } from "./engine";

/** The part of the engine the scheduler drives. */
export interface Schedulable {
  state(): SyncState;
  subscribe(listener: () => void): () => void;
  sync(): Promise<SyncState>;
  outcome(): CycleOutcome;
  reset(): void;
}

/** What the scheduler needs from the browser. Tests pass their own. */
export interface SchedulerEnvironment {
  /** Run something later. @returns A handle for {@link cancel}. */
  later(run: () => void, milliseconds: number): unknown;
  /** Cancel something scheduled with {@link later}. */
  cancel(handle: unknown): void;
  /** @returns A number from 0 up to, but not including, 1. */
  random(): number;
  /** @returns Whether the page can be seen. */
  visible(): boolean;
  /** Be told when the network comes back. @returns A way to stop. */
  onOnline(listener: () => void): () => void;
  /** Be told when the page is shown again. @returns A way to stop. */
  onVisible(listener: () => void): () => void;
}

/** The scheduler's timings, in milliseconds. */
export interface SchedulerTimings {
  /** The first wait after a failed cycle. */
  readonly retryBase: number;
  /** The longest wait after a failed cycle. */
  readonly retryLimit: number;
  /** How long after a local change to wait for more before sending. */
  readonly quiet: number;
  /** How long to wait when another tab is syncing. */
  readonly busy: number;
  /** How often to look for changes from other devices while idle. */
  readonly idle: number;
}

/** The timings the app uses. */
export const DEFAULT_TIMINGS: SchedulerTimings = {
  retryBase: 2_000,
  retryLimit: 5 * 60_000,
  quiet: 2_000,
  busy: 1_500,
  idle: 2 * 60_000,
};

/**
 * How long to wait before trying again after a number of failures in a row:
 * doubling from the base up to the limit, then anywhere in the upper half
 * of that, chosen at random.
 *
 * @param failures - Failed cycles in a row before this wait, from 0.
 * @param timings - The base and the limit.
 * @param random - A number from 0 up to 1.
 * @returns The wait in milliseconds.
 */
export function retryDelay(
  failures: number,
  timings: Pick<SchedulerTimings, "retryBase" | "retryLimit">,
  random: number,
): number {
  const ceiling = Math.min(
    timings.retryLimit,
    timings.retryBase * 2 ** Math.min(failures, 30),
  );
  return Math.round(ceiling * (0.5 + random / 2));
}

/** The browser, as the scheduler sees it. */
export function browserEnvironment(): SchedulerEnvironment {
  return {
    later: (run, milliseconds) => window.setTimeout(run, milliseconds),
    cancel: (handle) => {
      window.clearTimeout(handle as number);
    },
    random: () => Math.random(),
    visible: () => document.visibilityState === "visible",
    onOnline: (listener) => {
      window.addEventListener("online", listener);
      return () => {
        window.removeEventListener("online", listener);
      };
    },
    onVisible: (listener) => {
      const whenShown = (): void => {
        if (document.visibilityState === "visible") {
          listener();
        }
      };
      document.addEventListener("visibilitychange", whenShown);
      return () => {
        document.removeEventListener("visibilitychange", whenShown);
      };
    },
  };
}

/**
 * Let only one tab at a time sync an account, using the Web Locks API.
 * Two tabs share one local database, so two cycles at once would send the
 * same queued changes twice.
 *
 * @param locks - The browser's lock manager, or nothing where it has none.
 * @param name - The name of the lock: one per local database.
 * @returns A runner that skips the work while another tab holds the lock.
 *   Where the browser has no lock manager, the work always runs: sending
 *   an operation twice is safe, only wasteful.
 */
export function tabExclusive(
  locks: LockManager | undefined,
  name: () => string,
): Exclusive {
  if (locks === undefined) {
    return (work) => work();
  }
  return <T>(work: () => Promise<T>) =>
    locks.request(
      name(),
      { ifAvailable: true },
      (lock): Promise<T | undefined> =>
        lock === null ? Promise.resolve(undefined) : work(),
    );
}

/** Runs the engine at the right moments. This is what the app talks to. */
export class SyncScheduler implements SyncControl {
  readonly #engine: Schedulable;
  readonly #environment: SchedulerEnvironment;
  readonly #timings: SchedulerTimings;
  #stops: (() => void)[] = [];
  #timer: unknown;
  #started = false;
  /** Failed cycles in a row. */
  #failures = 0;
  /** The count of waiting records last seen, to notice a new local change. */
  #waiting = 0;
  /** The cycle in flight, so that two requests for one are counted once. */
  #cycle: Promise<SyncState> | undefined;
  /** Changes at every lock, so a cycle from before it plans nothing. */
  #generation = 0;
  /**
   * Whether a local change arrived while a cycle was running. That cycle
   * may have read what to send before the change was made.
   */
  #missed = false;

  /**
   * @param engine - The sync engine.
   * @param environment - Timers and browser events.
   * @param timings - How long each wait is.
   */
  constructor(
    engine: Schedulable,
    environment: SchedulerEnvironment = browserEnvironment(),
    timings: SchedulerTimings = DEFAULT_TIMINGS,
  ) {
    this.#engine = engine;
    this.#environment = environment;
    this.#timings = timings;
  }

  state(): SyncState {
    return this.#engine.state();
  }

  subscribe(listener: () => void): () => void {
    return this.#engine.subscribe(listener);
  }

  /** Run a cycle now, because the person asked or the app has reason to. */
  sync(): Promise<SyncState> {
    this.#failures = 0;
    return this.#run();
  }

  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#waiting = this.#engine.state().waiting;
    this.#stops = [
      this.#engine.subscribe(() => {
        this.#noticed();
      }),
      this.#environment.onOnline(() => {
        void this.sync();
      }),
      this.#environment.onVisible(() => {
        void this.#run();
      }),
    ];
    void this.#run();
  }

  reset(): void {
    this.#started = false;
    this.#generation += 1;
    this.#cycle = undefined;
    this.#missed = false;
    this.#cancel();
    for (const stop of this.#stops) {
      stop();
    }
    this.#stops = [];
    this.#failures = 0;
    this.#waiting = 0;
    this.#engine.reset();
  }

  #cancel(): void {
    if (this.#timer !== undefined) {
      this.#environment.cancel(this.#timer);
      this.#timer = undefined;
    }
  }

  #plan(milliseconds: number): void {
    this.#cancel();
    this.#timer = this.#environment.later(() => {
      this.#timer = undefined;
      // A page nobody is looking at waits until it is shown again.
      if (this.#environment.visible()) {
        void this.#run();
      }
    }, milliseconds);
  }

  /** The engine's state changed: send a new local change soon. */
  #noticed(): void {
    const { waiting } = this.#engine.state();
    const more = waiting > this.#waiting;
    this.#waiting = waiting;
    // While backing off, a new change waits for the retry already planned:
    // typing must not turn a slow retry into a fast one.
    if (!more || !this.#started) {
      return;
    }
    if (this.#cycle !== undefined) {
      // Planned when the running cycle ends: a timer set now would be
      // replaced by that cycle's own plan.
      this.#missed = true;
    } else if (this.#failures === 0) {
      this.#plan(this.#timings.quiet);
    }
  }

  #run(): Promise<SyncState> {
    this.#cancel();
    // A request made while a cycle runs joins it. The cycle's outcome is
    // then acted on once, however many asked for it.
    this.#cycle ??= this.#once(this.#generation);
    return this.#cycle;
  }

  async #once(generation: number): Promise<SyncState> {
    this.#missed = false;
    let state: SyncState;
    try {
      state = await this.#engine.sync();
    } finally {
      // The app may have locked, and unlocked again, while this ran. What
      // a cycle from before the lock found says nothing about now.
      if (generation === this.#generation) {
        this.#cycle = undefined;
      }
    }
    if (generation === this.#generation) {
      this.#next(this.#engine.outcome());
    }
    return state;
  }

  /** Plan the next cycle from how this one ended. */
  #next(outcome: CycleOutcome): void {
    switch (outcome) {
      case "offline":
      case "retry":
        // The count goes up after the wait is worked out, so the first
        // retry uses the base wait.
        this.#plan(
          retryDelay(this.#failures, this.#timings, this.#environment.random()),
        );
        this.#failures += 1;
        return;
      case "busy":
        this.#plan(this.#timings.busy);
        return;
      case "stopped":
      case "unavailable":
        // Nothing to wait for: the next unlock, change or tap tries again.
        this.#failures = 0;
        return;
      case "done":
        this.#failures = 0;
        // A change made while the cycle ran may not have been in it.
        this.#plan(this.#missed ? this.#timings.quiet : this.#timings.idle);
        return;
    }
  }
}
