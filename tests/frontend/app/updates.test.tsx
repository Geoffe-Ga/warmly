import { cleanup, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UPDATE_NOT_APPLIED } from "../../../src/app/App";
import { appUpdates, createUpdates } from "../../../src/app/updates";

import { renderApp, testServices } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const READY = "A new version of Warmly is ready.";

describe("a new version waiting to be used (REL-004, AC-28)", () => {
  it("is not available until one is offered, and tells listeners when it is", () => {
    const updates = createUpdates();
    const told = vi.fn();
    const stop = updates.subscribe(told);

    expect(updates.available()).toBe(false);
    updates.offer(() => Promise.resolve());

    expect(updates.available()).toBe(true);
    expect(told).toHaveBeenCalledTimes(1);
    stop();
    updates.offer(() => Promise.resolve());
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("switches only when asked, and does nothing when none is waiting", async () => {
    const updates = createUpdates();
    const activate = vi.fn(() => Promise.resolve());

    await updates.apply();
    updates.offer(activate);
    expect(activate).not.toHaveBeenCalled();

    await updates.apply();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("the app has one holder, with nothing waiting to begin with", () => {
    expect(appUpdates.available()).toBe(false);
  });
});

describe("the update notice (REL-004, AC-28)", () => {
  it("says nothing and offers nothing while no version is waiting", async () => {
    await renderApp("/", testServices("unlocked"));

    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
  });

  it("appears when a version starts waiting, and never switches by itself", async () => {
    const services = testServices("unlocked");
    const activate = vi.fn(() => Promise.resolve());
    await renderApp("/", services);

    services.updates.offer(activate);

    const notice = await screen.findByText(READY);
    expect(notice.getAttribute("role")).toBe("status");
    expect(screen.getByRole("button", { name: "Update now" })).toBeTruthy();
    expect(activate).not.toHaveBeenCalled();
  });

  it("is shown before signing in too: the text is fixed and says nothing private", async () => {
    const services = testServices("signed_out");
    services.updates.offer(() => Promise.resolve());

    await renderApp("/welcome", services);

    await screen.findByText(READY);
  });

  it("saves unsaved writing first, then switches", async () => {
    const services = testServices("unlocked");
    const order: string[] = [];
    services.lockHooks.register(() => {
      order.push("saved");
      return Promise.resolve();
    });
    services.updates.offer(() => {
      order.push("switched");
      return Promise.resolve();
    });
    await renderApp("/", services);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Update now" }));

    await waitFor(() => {
      expect(order).toEqual(["saved", "switched"]);
    });
  });

  it("does not switch if the writing could not be saved, and says so", async () => {
    const services = testServices("unlocked");
    const activate = vi.fn(() => Promise.resolve());
    services.lockHooks.register(() => Promise.reject(new Error("synthetic")));
    services.updates.offer(activate);
    await renderApp("/", services);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Update now" }));

    await screen.findByText(UPDATE_NOT_APPLIED);
    expect(activate).not.toHaveBeenCalled();
    // The person can try again.
    const again = screen.getByRole("button", { name: "Update now" });
    await waitFor(() => {
      expect(again.hasAttribute("aria-disabled")).toBe(false);
    });
  });

  it("says so if switching itself fails, and stays usable", async () => {
    const services = testServices("unlocked");
    services.updates.offer(() => Promise.reject(new Error("synthetic")));
    await renderApp("/", services);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Update now" }));

    await screen.findByText(UPDATE_NOT_APPLIED);
    expect(screen.queryByText("synthetic")).toBeNull();
  });

  it("the button waits while the update is being applied", async () => {
    const services = testServices("unlocked");
    let finish: (() => void) | undefined;
    services.updates.offer(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderApp("/", services);
    const button = await screen.findByRole("button", { name: "Update now" });

    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(button.getAttribute("aria-disabled")).toBe("true");
    });
    finish?.();
    await waitFor(() => {
      expect(button.hasAttribute("aria-disabled")).toBe(false);
    });
  });
});
