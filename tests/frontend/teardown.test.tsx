/**
 * The shared test setup finishes a screen's cleanup before a test ends.
 *
 * Preact runs an unmounted component's effect cleanups a moment later, on
 * a timer. If that moment comes after a test file's browser environment
 * has gone, the cleanup fails on a missing `window` and the whole run is
 * reported as failed, now and then. `tests/frontend/setup.ts` makes the
 * cleanups run before each test ends. These two tests fail, every time,
 * without it.
 */
import { cleanup, render } from "@testing-library/preact";
import { useEffect } from "preact/hooks";
import { afterEach, describe, expect, it } from "vitest";

// As every screen test does. On its own this unmounts, but leaves the
// effect cleanups waiting for their timer.
afterEach(() => {
  cleanup();
});

const seen = { cleanedUp: false };

function Listening(): null {
  useEffect(
    () => () => {
      seen.cleanedUp = true;
    },
    [],
  );
  return null;
}

describe("after each test, what was rendered has finished cleaning up", () => {
  it("renders a component whose effect has something to clean up", async () => {
    render(<Listening />);
    // Let the effect itself run, so there is a cleanup to do.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(seen.cleanedUp).toBe(false);
  });

  it("finds it already cleaned up when the next test starts", () => {
    expect(seen.cleanedUp).toBe(true);
  });
});
