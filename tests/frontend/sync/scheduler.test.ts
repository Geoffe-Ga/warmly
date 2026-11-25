import { afterEach, describe, expect, it, vi } from "vitest";

import type { CycleOutcome, SyncState } from "../../../src/sync/engine";
import {
  DEFAULT_TIMINGS,
  SyncScheduler,
  browserEnvironment,
  retryDelay,
  tabExclusive,
  type Schedulable,
  type SchedulerEnvironment,
  type SchedulerTimings,
} from "../../../src/sync/scheduler";

const TIMINGS: SchedulerTimings = {
  retryBase: 1_000,
  retryLimit: 8_000,
  quiet: 200,
  busy: 50,
  idle: 60_000,
};

/** An engine whose cycles end the way the test says. */
function engine(...outcomes: CycleOutcome[]): Schedulable & {
  runs: number;
  resets: number;
  waiting(count: number): void;
} {
  const listeners = new Set<() => void>();
  let state: SyncState = { status: "synced", waiting: 0 };
  let last: CycleOutcome = "done";
  const made = {
    runs: 0,
    resets: 0,
    state: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync: () => {
      last = outcomes[made.runs] ?? "done";
      made.runs += 1;
      return Promise.resolve(state);
    },
    outcome: () => last,
    reset: () => {
      made.resets += 1;
    },
    waiting: (count: number) => {
      state = { status: count > 0 ? "pending" : "synced", waiting: count };
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
  return made;
}

/** Timers and events the test moves by hand. */
function environment(): SchedulerEnvironment & {
  /** The waits currently planned, in milliseconds. */
  planned(): number[];
  /** Let the one planned timer fire. */
  fire(): Promise<void>;
  online(): Promise<void>;
  shown(): Promise<void>;
  hidden: boolean;
  chance: number;
  listening(): number;
} {
  const timers = new Map<number, { run: () => void; milliseconds: number }>();
  const online = new Set<() => void>();
  const visible = new Set<() => void>();
  let handles = 0;
  const settle = (): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  const made = {
    hidden: false,
    chance: 0.999_999,
    later: (run: () => void, milliseconds: number) => {
      handles += 1;
      timers.set(handles, { run, milliseconds });
      return handles;
    },
    cancel: (handle: unknown) => {
      timers.delete(handle as number);
    },
    random: () => made.chance,
    visible: () => !made.hidden,
    onOnline: (listener: () => void) => {
      online.add(listener);
      return () => {
        online.delete(listener);
      };
    },
    onVisible: (listener: () => void) => {
      visible.add(listener);
      return () => {
        visible.delete(listener);
      };
    },
    planned: () => [...timers.values()].map((timer) => timer.milliseconds),
    fire: async () => {
      const [[handle, timer] = []] = [...timers.entries()];
      if (handle === undefined || timer === undefined) {
        throw new Error("no timer is planned");
      }
      timers.delete(handle);
      timer.run();
      await settle();
    },
    online: async () => {
      for (const listener of [...online]) {
        listener();
      }
      await settle();
    },
    shown: async () => {
      for (const listener of [...visible]) {
        listener();
      }
      await settle();
    },
    listening: () => online.size + visible.size,
  };
  return made;
}

async function started(...outcomes: CycleOutcome[]): Promise<{
  sync: ReturnType<typeof engine>;
  browser: ReturnType<typeof environment>;
  scheduler: SyncScheduler;
}> {
  const sync = engine(...outcomes);
  const browser = environment();
  const scheduler = new SyncScheduler(sync, browser, TIMINGS);
  scheduler.start();
  await vi.waitFor(() => {
    expect(sync.runs).toBe(1);
    expect(browser.planned().length + (outcomes[0] === "stopped" ? 1 : 0)).toBe(
      1,
    );
  });
  return { sync, browser, scheduler };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("how long to wait before trying again (SYNC-008)", () => {
  it("doubles from the base and stops at the limit", () => {
    const waits = [0, 1, 2, 3, 4, 50, 5_000].map((failures) =>
      retryDelay(failures, TIMINGS, 1),
    );

    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000]);
  });

  it("is somewhere in the upper half of that, chosen at random", () => {
    expect(retryDelay(2, TIMINGS, 0)).toBe(2_000);
    expect(retryDelay(2, TIMINGS, 0.5)).toBe(3_000);
    expect(retryDelay(2, TIMINGS, 1)).toBe(4_000);
  });

  it("starts at two seconds and never waits more than five minutes in the app", () => {
    expect(retryDelay(0, DEFAULT_TIMINGS, 1)).toBe(2_000);
    expect(retryDelay(100, DEFAULT_TIMINGS, 1)).toBe(300_000);
  });
});

describe("when sync runs on its own (SYNC-008, SYNC-010)", () => {
  it("runs once when started, then looks again after the idle wait", async () => {
    const { sync, browser } = await started("done", "done");

    expect(browser.planned()).toEqual([TIMINGS.idle]);
    await browser.fire();

    expect(sync.runs).toBe(2);
    expect(browser.planned()).toEqual([TIMINGS.idle]);
  });

  it("does not start twice", async () => {
    const { sync, browser, scheduler } = await started("done");

    scheduler.start();
    await browser.shown();

    expect(sync.runs).toBe(2);
    expect(browser.listening()).toBe(2);
  });

  it.each(["offline", "retry"] as const)(
    "waits longer after each %s cycle in a row, up to the limit",
    async (outcome) => {
      const { sync, browser } = await started(
        outcome,
        outcome,
        outcome,
        outcome,
        outcome,
      );
      const waits = [...browser.planned()];

      for (let cycle = 0; cycle < 4; cycle += 1) {
        await browser.fire();
        waits.push(...browser.planned());
      }

      expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
      expect(sync.runs).toBe(5);
    },
  );

  it("spreads retries out at random", async () => {
    const sync = engine("offline");
    const browser = environment();
    browser.chance = 0;
    new SyncScheduler(sync, browser, TIMINGS).start();

    await vi.waitFor(() => {
      expect(browser.planned()).toEqual([500]);
    });
  });

  it("goes back to short waits once a cycle works", async () => {
    const { browser } = await started("offline", "offline", "done", "offline");

    await browser.fire();
    expect(browser.planned()).toEqual([2_000]);
    await browser.fire();
    expect(browser.planned()).toEqual([TIMINGS.idle]);
    await browser.fire();

    expect(browser.planned()).toEqual([1_000]);
  });

  it("tries at once when the network comes back, and starts the waits over", async () => {
    const { sync, browser } = await started("offline", "offline", "offline");
    await browser.fire();
    expect(browser.planned()).toEqual([2_000]);

    await browser.online();

    expect(sync.runs).toBe(3);
    // One retry planned, counted from the beginning again.
    expect(browser.planned()).toEqual([1_000]);
  });

  it("looks for changes when the page is shown again", async () => {
    const { sync, browser } = await started("done", "done");

    await browser.shown();

    expect(sync.runs).toBe(2);
    expect(browser.planned()).toEqual([TIMINGS.idle]);
  });

  it("does not run in a page nobody is looking at, and catches up when it is shown", async () => {
    const { sync, browser } = await started("done", "done");
    browser.hidden = true;

    await browser.fire();
    expect(sync.runs).toBe(1);
    expect(browser.planned()).toEqual([]);

    browser.hidden = false;
    await browser.shown();
    expect(sync.runs).toBe(2);
  });

  it("sends a local change after a short quiet wait, once for a burst", async () => {
    const { sync, browser } = await started("done", "done");

    sync.waiting(1);
    sync.waiting(2);
    sync.waiting(3);

    expect(browser.planned()).toEqual([TIMINGS.quiet]);
    await browser.fire();
    expect(sync.runs).toBe(2);
  });

  it("does not hurry for a count that went down or stayed the same", async () => {
    const { sync, browser } = await started("done");
    sync.waiting(2);
    await browser.fire();

    sync.waiting(2);
    sync.waiting(1);
    sync.waiting(0);

    expect(browser.planned()).toEqual([TIMINGS.idle]);
  });

  it("does not let typing turn a slow retry into a fast one", async () => {
    const { sync, browser } = await started("offline", "offline");
    await browser.fire();
    expect(browser.planned()).toEqual([2_000]);

    sync.waiting(1);
    sync.waiting(2);

    expect(browser.planned()).toEqual([2_000]);
  });

  it("tries again shortly when another tab is syncing, without backing off", async () => {
    const { browser } = await started("busy", "busy", "offline");

    expect(browser.planned()).toEqual([TIMINGS.busy]);
    await browser.fire();
    expect(browser.planned()).toEqual([TIMINGS.busy]);
    await browser.fire();

    expect(browser.planned()).toEqual([1_000]);
  });

  it.each(["stopped", "unavailable"] as const)(
    "does not retry on a timer after a %s cycle, but a new change or a tap tries again",
    async (outcome) => {
      const sync = engine(outcome, outcome, "done");
      const browser = environment();
      const scheduler = new SyncScheduler(sync, browser, TIMINGS);
      scheduler.start();
      await vi.waitFor(() => {
        expect(sync.runs).toBe(1);
      });
      expect(browser.planned()).toEqual([]);

      sync.waiting(1);
      expect(browser.planned()).toEqual([TIMINGS.quiet]);
      await browser.fire();
      expect(browser.planned()).toEqual([]);

      await scheduler.sync();
      expect(sync.runs).toBe(3);
      expect(browser.planned()).toEqual([TIMINGS.idle]);
    },
  );

  it("runs now when asked, and counts the waits from the beginning", async () => {
    const { sync, browser, scheduler } = await started(
      "offline",
      "offline",
      "offline",
    );
    await browser.fire();

    const state = await scheduler.sync();

    expect(state).toEqual(sync.state());
    expect(sync.runs).toBe(3);
    expect(browser.planned()).toEqual([1_000]);
  });

  it("passes the engine's state and changes straight through", async () => {
    const { sync, scheduler } = await started("done");
    const told = vi.fn();
    const stop = scheduler.subscribe(told);

    sync.waiting(4);
    expect(scheduler.state()).toEqual({ status: "pending", waiting: 4 });
    expect(told).toHaveBeenCalledTimes(1);

    stop();
    sync.waiting(5);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("stops everything when the app locks: no timer, no listener, nothing in memory", async () => {
    const { sync, browser, scheduler } = await started("done", "done");
    sync.waiting(1);

    scheduler.reset();

    expect(browser.planned()).toEqual([]);
    expect(browser.listening()).toBe(0);
    expect(sync.resets).toBe(1);
    sync.waiting(2);
    await browser.online();
    await browser.shown();
    expect(sync.runs).toBe(1);
    expect(browser.planned()).toEqual([]);
  });

  it("plans nothing if the app locks while a cycle is running", async () => {
    const sync = engine("offline");
    const browser = environment();
    const scheduler = new SyncScheduler(sync, browser, TIMINGS);

    scheduler.start();
    scheduler.reset();
    await vi.waitFor(() => {
      expect(sync.runs).toBe(1);
    });

    expect(browser.planned()).toEqual([]);
  });

  it("counts one failed cycle once, however many asked for it", async () => {
    let finish: (() => void) | undefined;
    const sync = engine("offline", "offline");
    const slow = sync.sync;
    sync.sync = () =>
      new Promise((resolve) => {
        finish = () => {
          void slow().then(resolve);
        };
      });
    const browser = environment();
    const scheduler = new SyncScheduler(sync, browser, TIMINGS);

    scheduler.start();
    const asked = scheduler.sync();
    await browser.shown();
    finish?.();
    await asked;

    expect(sync.runs).toBe(1);
    // The first wait, not the second or third.
    expect(browser.planned()).toEqual([1_000]);
  });

  it("ignores a cycle from before a lock, even if the app has unlocked again", async () => {
    const finishes: (() => void)[] = [];
    const sync = engine("offline", "done");
    const real = sync.sync;
    sync.sync = () =>
      new Promise((resolve) => {
        finishes.push(() => {
          void real().then(resolve);
        });
      });
    const browser = environment();
    const scheduler = new SyncScheduler(sync, browser, TIMINGS);

    scheduler.start();
    scheduler.reset();
    scheduler.start();
    // The cycle from before the lock ends first, having found no network.
    finishes[0]?.();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(browser.planned()).toEqual([]);

    finishes[1]?.();
    await vi.waitFor(() => {
      expect(browser.planned()).toEqual([TIMINGS.idle]);
    });
  });

  it("can be started again after a lock", async () => {
    const { sync, browser, scheduler } = await started("done", "done");
    scheduler.reset();

    scheduler.start();

    await vi.waitFor(() => {
      expect(sync.runs).toBe(2);
      expect(browser.planned()).toEqual([TIMINGS.idle]);
    });
    expect(browser.listening()).toBe(2);
  });
});

describe("the browser as the scheduler sees it", () => {
  it("runs things later and can cancel them", () => {
    vi.useFakeTimers();
    try {
      const browser = browserEnvironment();
      const ran = vi.fn();
      const cancelled = vi.fn();

      browser.later(ran, 50);
      browser.cancel(browser.later(cancelled, 50));
      vi.advanceTimersByTime(60);

      expect(ran).toHaveBeenCalledTimes(1);
      expect(cancelled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a random number below one", () => {
    const value = browserEnvironment().random();

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it("says when the network comes back, until told to stop", () => {
    const told = vi.fn();
    const stop = browserEnvironment().onOnline(told);

    window.dispatchEvent(new Event("online"));
    stop();
    window.dispatchEvent(new Event("online"));

    expect(told).toHaveBeenCalledTimes(1);
  });

  it("says when the page is shown, not when it is hidden, until told to stop", () => {
    const browser = browserEnvironment();
    const told = vi.fn();
    const stop = browser.onVisible(told);
    const state = vi.spyOn(document, "visibilityState", "get");

    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(browser.visible()).toBe(false);
    expect(told).not.toHaveBeenCalled();

    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(browser.visible()).toBe(true);
    expect(told).toHaveBeenCalledTimes(1);

    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(told).toHaveBeenCalledTimes(1);
  });
});

describe("one tab at a time (SYNC-008)", () => {
  /** A lock manager that holds each name for one caller at a time. */
  function locks(): LockManager & { asked: [string, LockOptions][] } {
    const held = new Set<string>();
    const asked: [string, LockOptions][] = [];
    const request = async (
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => Promise<unknown>,
    ): Promise<unknown> => {
      asked.push([name, options]);
      if (held.has(name)) {
        return callback(null);
      }
      held.add(name);
      try {
        return await callback({ name, mode: "exclusive" });
      } finally {
        held.delete(name);
      }
    };
    return { asked, request, query: vi.fn() } as unknown as LockManager & {
      asked: [string, LockOptions][];
    };
  }

  it("always runs the work where the browser has no lock manager", async () => {
    const exclusive = tabExclusive(undefined, () => "name");

    expect(await exclusive(() => Promise.resolve("ran"))).toBe("ran");
  });

  it("runs the work under a lock named for the account's database, without waiting", async () => {
    const manager = locks();
    let name = "warmly-sync:first";
    const exclusive = tabExclusive(manager, () => name);

    expect(await exclusive(() => Promise.resolve(7))).toBe(7);
    name = "warmly-sync:second";
    await exclusive(() => Promise.resolve(8));

    expect(manager.asked).toEqual([
      ["warmly-sync:first", { ifAvailable: true }],
      ["warmly-sync:second", { ifAvailable: true }],
    ]);
  });

  it("skips the work while another tab holds the lock, and runs it afterwards", async () => {
    const manager = locks();
    const [first, second] = [
      tabExclusive(manager, () => "same"),
      tabExclusive(manager, () => "same"),
    ];
    let finish: (() => void) | undefined;
    const skipped = vi.fn(() => Promise.resolve("ran"));

    const running = first(
      () =>
        new Promise<string>((resolve) => {
          finish = () => {
            resolve("first");
          };
        }),
    );
    await vi.waitFor(() => {
      expect(finish).toBeDefined();
    });
    expect(await second(skipped)).toBeUndefined();
    expect(skipped).not.toHaveBeenCalled();

    finish?.();
    expect(await running).toBe("first");
    expect(await second(skipped)).toBe("ran");
  });

  it("lets the lock go when the work fails", async () => {
    const manager = locks();
    const exclusive = tabExclusive(manager, () => "same");

    await expect(
      exclusive(() => Promise.reject(new Error("synthetic"))),
    ).rejects.toThrow("synthetic");

    expect(await exclusive(() => Promise.resolve("ran"))).toBe("ran");
  });
});
