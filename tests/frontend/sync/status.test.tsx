import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dropSecrets } from "../../../src/app/SessionControls";
import type { SyncControl, SyncState } from "../../../src/sync/engine";
import {
  SyncNow,
  SyncStatus,
  describeSync,
} from "../../../src/ui/components/SyncStatus";
import { openMenu, renderApp, testServices } from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A sync control whose state the test sets. */
function control(start: SyncState): SyncControl & {
  set(state: SyncState): void;
  runs: number;
  resets: number;
  finish: () => void;
} {
  let state = start;
  const listeners = new Set<() => void>();
  let finish: () => void = () => undefined;
  const made = {
    runs: 0,
    resets: 0,
    finish: () => {
      finish();
    },
    state: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync: () => {
      made.runs += 1;
      return new Promise<SyncState>((resolve) => {
        finish = () => {
          resolve(state);
        };
      });
    },
    start: () => undefined,
    reset: () => {
      made.resets += 1;
    },
    set: (next: SyncState) => {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
  return made;
}

describe("the sync status in words (SYNC-010)", () => {
  it.each([
    [{ status: "synced", waiting: 0 }, "All changes saved"],
    [{ status: "pending", waiting: 1 }, "1 change waiting to sync"],
    [{ status: "pending", waiting: 3 }, "3 changes waiting to sync"],
    [{ status: "attention", waiting: 2 }, "Needs your attention"],
    [{ status: "offline", waiting: 3 }, "3 changes waiting to sync"],
    [{ status: "offline", waiting: 0 }, ""],
    [
      { status: "outdated", waiting: 2 },
      "Update Warmly to keep syncing. Your writing is saved on this device.",
    ],
    [
      { status: "failed", waiting: 2 },
      "Couldn't sync. Your writing is saved on this device.",
    ],
  ] as const)("%j is %j", (state, text) => {
    expect(describeSync(state)).toBe(text);
  });
});

describe("the sync status indicator (SYNC-010, AC-23)", () => {
  it("shows the state in a polite live region and follows it as it changes", async () => {
    const sync = control({ status: "synced", waiting: 0 });
    render(<SyncStatus sync={sync} />);
    const region = screen.getByRole("status");

    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("All changes saved");

    sync.set({ status: "pending", waiting: 3 });
    await waitFor(() => {
      expect(region.textContent).toBe("3 changes waiting to sync");
    });
    sync.set({ status: "attention", waiting: 3 });
    await waitFor(() => {
      expect(region.textContent).toBe("Needs your attention");
    });
  });

  it("runs a sync when asked, and the button waits while it runs", async () => {
    const sync = control({ status: "pending", waiting: 1 });
    render(<SyncNow sync={sync} />);
    const button = screen.getByRole("button", { name: "Sync now" });

    await userEvent.click(button);

    expect(sync.runs).toBe(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // A second press while it runs starts nothing.
    await userEvent.click(button);
    expect(sync.runs).toBe(1);
    sync.finish();
    await waitFor(() => {
      expect(button.hasAttribute("aria-disabled")).toBe(false);
    });
  });

  it("links to the review only when something needs the person", async () => {
    const sync = control({ status: "pending", waiting: 1 });
    render(<SyncStatus sync={sync} />);
    expect(screen.queryByRole("link")).toBeNull();

    sync.set({ status: "attention", waiting: 1 });

    const link = await screen.findByRole("link", {
      name: "Review what changed",
    });
    expect(link.getAttribute("href")).toBe("/sync/conflicts");

    sync.set({ status: "synced", waiting: 0 });
    await waitFor(() => {
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  it("stops following the state when it is removed", async () => {
    const sync = control({ status: "offline", waiting: 1 });
    render(<SyncStatus sync={sync} />);
    const status = screen.getByRole("status");

    cleanup();
    sync.set({ status: "synced", waiting: 0 });

    expect(status.textContent).toBe("1 change waiting to sync");
  });

  it("shows the status only while unlocked", async () => {
    await renderApp("/", testServices("unlocked"));
    await openMenu();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
    expect(document.querySelector(".sync-status")?.textContent).toContain(
      "All changes saved",
    );

    for (const state of ["signed_out", "signed_in_locked"] as const) {
      cleanup();
      await renderApp("/", testServices(state));
      expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
      expect(document.querySelector(".sync-status")).toBeNull();
    }
  });

  it("forgets what sync held in memory when the secrets are dropped", () => {
    const services = testServices("unlocked");
    const reset = vi.spyOn(services.sync, "reset");

    dropSecrets(services);

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
