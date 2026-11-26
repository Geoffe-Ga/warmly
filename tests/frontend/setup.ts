/**
 * Vitest setup.
 *
 * 1. Provide an in-memory IndexedDB so offline-storage code (PRD SYNC-001)
 *    can be unit-tested under jsdom.
 * 2. Forbid network access (PRD AC-03). A test that needs a response replaces
 *    `fetch` with its own double.
 * 3. Finish every screen's cleanup before a test ends.
 *
 *    Preact runs an unmounted component's effect cleanups after the next
 *    paint, which under jsdom is a timer about 35 ms later. Unmounting at
 *    the end of a test therefore leaves cleanups still to run. When the
 *    test was the last in its file, the timer can fire after the file's
 *    browser environment has been torn down, the cleanup reads a `window`
 *    that is gone, and Vitest reports the whole run as failed although
 *    every test passed. That happened in roughly one run in five.
 *
 *    So after each test this unmounts whatever is still mounted and then
 *    makes Preact run its waiting cleanups at once. Preact only runs them
 *    when an effect is scheduled, and `act` runs scheduled effects before
 *    it returns, so a component with one empty effect is rendered inside
 *    `act` to bring the flush forward. `tests/frontend/teardown.test.tsx`
 *    fails without this.
 */
import "fake-indexeddb/auto";

import { cleanup } from "@testing-library/preact";
import { h, render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach } from "vitest";

import { installNetworkGuard } from "./network-guard";

installNetworkGuard(globalThis);

/** Renders nothing. Its one effect makes Preact flush what is waiting. */
function Flush(): null {
  useEffect(() => undefined, []);
  return null;
}

afterEach(async () => {
  if (typeof document === "undefined") {
    // A test file that runs without a browser environment renders nothing.
    return;
  }
  cleanup();
  await act(() => {
    const scratch = document.createElement("div");
    render(h(Flush, null), scratch);
    render(null, scratch);
  });
});
