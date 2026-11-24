import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLUSH_TIMEOUT_MS, createLockHooks } from "../../../src/app/lock-hooks";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("work that must finish before locking (DEV-005)", () => {
  it("waits for every registered hook", async () => {
    const hooks = createLockHooks();
    const finished: string[] = [];
    hooks.register(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      finished.push("draft");
    });
    hooks.register(() => {
      finished.push("index");
      return Promise.resolve();
    });

    const flushing = hooks.flush();
    await vi.advanceTimersByTimeAsync(199);
    expect(finished).toEqual(["index"]);
    await vi.advanceTimersByTimeAsync(1);

    expect(await flushing).toBe(0);
    expect(finished).toEqual(["index", "draft"]);
  });

  it("does nothing, at once, when there are no hooks", async () => {
    expect(await createLockHooks().flush()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a failing hook stop the lock, and reports it", async () => {
    const hooks = createLockHooks();
    let saved = false;
    hooks.register(() => Promise.reject(new Error("disk full")));
    hooks.register(() => {
      throw new Error("thrown at once");
    });
    hooks.register(() => {
      saved = true;
      return Promise.resolve();
    });

    expect(await hooks.flush()).toBe(2);
    expect(saved).toBe(true);
  });

  it("gives up on a hook that never finishes, after the timeout", async () => {
    const hooks = createLockHooks();
    hooks.register(() => new Promise<void>(() => undefined));

    const flushing = hooks.flush();
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS - 1);
    let settled = false;
    void flushing.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await flushing).toBe(1);
  });

  it("stops calling a hook once it is removed", async () => {
    const hooks = createLockHooks();
    let calls = 0;
    const remove = hooks.register(() => {
      calls += 1;
      return Promise.resolve();
    });
    await hooks.flush();

    remove();
    await hooks.flush();

    expect(calls).toBe(1);
  });

  it("leaves no timer behind", async () => {
    const hooks = createLockHooks();
    hooks.register(() => Promise.resolve());

    await hooks.flush();

    expect(vi.getTimerCount()).toBe(0);
  });
});
