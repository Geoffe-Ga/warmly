import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INACTIVITY_LIMIT_MS,
  watchInactivity,
  type InactivityWatch,
} from "../../../src/app/inactivity";

/** A document stand-in whose visibility the test controls. */
class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";

  show(): void {
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }

  hide(): void {
    this.visibilityState = "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const MINUTE = 60_000;
let target: EventTarget;
let page: Page;
let idle: number;
let watch: InactivityWatch;

beforeEach(() => {
  vi.useFakeTimers();
  target = new EventTarget();
  page = new Page();
  idle = 0;
  watch = watchInactivity({
    onIdle: () => {
      idle += 1;
    },
    target,
    page,
  });
});

afterEach(() => {
  watch.stop();
  vi.useRealTimers();
});

describe("inactivity lock clock (DEV-005, AC-21)", () => {
  it("has a 30-minute limit", () => {
    expect(INACTIVITY_LIMIT_MS).toBe(30 * MINUTE);
  });

  it("fires at 30 minutes of inactivity and not a millisecond before", () => {
    vi.advanceTimersByTime(30 * MINUTE - 1);
    expect(idle).toBe(0);

    vi.advanceTimersByTime(1);
    expect(idle).toBe(1);
  });

  it("fires once, then stops", () => {
    vi.advanceTimersByTime(90 * MINUTE);

    expect(idle).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["pointerdown", "keydown", "wheel", "touchstart", "input"])(
    "%s counts as activity and restarts the 30 minutes",
    (name) => {
      vi.advanceTimersByTime(29 * MINUTE);
      target.dispatchEvent(new Event(name));

      vi.advanceTimersByTime(30 * MINUTE - 1);
      expect(idle).toBe(0);

      vi.advanceTimersByTime(1);
      expect(idle).toBe(1);
    },
  );

  it("does not count movement without input as activity", () => {
    vi.advanceTimersByTime(29 * MINUTE);
    target.dispatchEvent(new Event("mousemove"));
    target.dispatchEvent(new Event("scroll"));

    vi.advanceTimersByTime(MINUTE);

    expect(idle).toBe(1);
  });

  it("locks on resume when the tab slept past the limit", () => {
    page.hide();
    // A suspended tab runs no timers: only the wall clock moves.
    vi.setSystemTime(Date.now() + 45 * MINUTE);
    expect(idle).toBe(0);

    page.show();

    expect(idle).toBe(1);
  });

  it("does not lock on resume before the limit, and keeps counting from the last input", () => {
    vi.advanceTimersByTime(10 * MINUTE);
    page.hide();
    vi.setSystemTime(Date.now() + 15 * MINUTE);
    page.show();
    expect(idle).toBe(0);

    vi.advanceTimersByTime(5 * MINUTE - 1);
    expect(idle).toBe(0);
    vi.advanceTimersByTime(1);
    expect(idle).toBe(1);
  });

  it("stops listening and clears its timer when stopped", () => {
    watch.stop();

    vi.advanceTimersByTime(90 * MINUTE);
    page.show();

    expect(idle).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores input after it has stopped", () => {
    watch.stop();
    target.dispatchEvent(new Event("keydown"));

    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a different limit and clock", () => {
    let clock = 1_000;
    let fired = 0;
    const custom = watchInactivity({
      onIdle: () => {
        fired += 1;
      },
      limitMs: 500,
      now: () => clock,
      target,
      page,
    });

    clock += 499;
    page.show();
    expect(fired).toBe(0);
    clock += 1;
    page.show();
    expect(fired).toBe(1);
    custom.stop();
  });

  it("watches the real window and document by default", () => {
    let fired = 0;
    const real = watchInactivity({
      onIdle: () => {
        fired += 1;
      },
    });

    vi.advanceTimersByTime(29 * MINUTE);
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(29 * MINUTE);
    expect(fired).toBe(0);
    vi.advanceTimersByTime(MINUTE);
    expect(fired).toBe(1);
    real.stop();
  });
});
