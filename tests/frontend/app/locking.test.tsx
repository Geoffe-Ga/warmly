import { cleanup, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOCKED_PATH } from "../../../src/app/access";
import { INACTIVITY_LIMIT_MS } from "../../../src/app/inactivity";
import { lockNow, useInactivityLock } from "../../../src/app/SessionControls";
import type { SessionState } from "../../../src/app/session";
import { FAKE_RECOVERY_KEY } from "../../../src/testing/fake-key-vault";

import { setUpKeys, testServices, type TestServices } from "./helpers";

async function unlocked(): Promise<TestServices> {
  const services = testServices("unlocked");
  await setUpKeys(services.vault);
  return services;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("locking (DEV-005, AC-21)", () => {
  it("drops the keys, locks the session and shows the locked screen", async () => {
    const services = await unlocked();
    services.onboarding.holdRecoveryKey(FAKE_RECOVERY_KEY);
    const visited: string[] = [];

    await lockNow(services, (path) => visited.push(path));

    expect(services.vault.isUnlocked).toBe(false);
    expect(services.session.state).toBe("signed_in_locked");
    expect(services.onboarding.recoveryKey).toBeUndefined();
    expect(visited).toEqual([LOCKED_PATH]);
  });

  it("lets a registered hook finish while the keys are still available", async () => {
    const services = await unlocked();
    const seen: { keysAvailable: boolean; state: SessionState }[] = [];
    services.lockHooks.register(async () => {
      await Promise.resolve();
      // What a draft save would need: the keys, and an unlocked session.
      seen.push({
        keysAvailable: services.vault.isUnlocked,
        state: services.session.state,
      });
    });

    await lockNow(services, () => undefined);

    expect(seen).toEqual([{ keysAvailable: true, state: "unlocked" }]);
    expect(services.vault.isUnlocked).toBe(false);
  });

  it("still locks when saving fails", async () => {
    const services = await unlocked();
    services.lockHooks.register(() => Promise.reject(new Error("disk full")));

    await lockNow(services, () => undefined);

    expect(services.vault.isUnlocked).toBe(false);
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("still locks when saving never finishes", async () => {
    vi.useFakeTimers();
    const services = await unlocked();
    services.lockHooks.register(() => new Promise<void>(() => undefined));

    const locking = lockNow(services, () => undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    await locking;

    expect(services.vault.isUnlocked).toBe(false);
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("does nothing when the app is not unlocked", async () => {
    const services = testServices("signed_in_locked");
    let flushed = 0;
    services.lockHooks.register(() => {
      flushed += 1;
      return Promise.resolve();
    });
    const visited: string[] = [];

    await lockNow(services, (path) => visited.push(path));

    expect(flushed).toBe(0);
    expect(visited).toEqual([]);
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("does not lock a session that ended while work was being saved", async () => {
    const services = await unlocked();
    services.lockHooks.register(() => {
      services.vault.lock();
      services.session.signOut();
      return Promise.resolve();
    });
    const visited: string[] = [];

    await lockNow(services, (path) => visited.push(path));

    expect(services.session.state).toBe("signed_out");
    expect(visited).toEqual([]);
  });

  it("a second lock while the first is saving is harmless", async () => {
    const services = await unlocked();
    let release: () => void = () => undefined;
    services.lockHooks.register(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const visited: string[] = [];
    const go = (path: string): void => {
      visited.push(path);
    };

    const first = lockNow(services, go);
    const second = lockNow(services, go);
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(services.session.state).toBe("signed_in_locked");
    expect(visited).toEqual([LOCKED_PATH]);
  });
});

describe("the inactivity lock in the app (DEV-005, AC-21)", () => {
  function Harness(props: {
    readonly services: TestServices;
    readonly state: SessionState;
    readonly navigate: (path: string) => void;
  }): null {
    useInactivityLock(props.services, props.state, props.navigate);
    return null;
  }

  it("locks an unlocked app at 30 minutes and not before", async () => {
    const services = await unlocked();
    vi.useFakeTimers();
    const visited: string[] = [];
    const navigate = (path: string): void => {
      visited.push(path);
    };
    render(
      <Harness services={services} state="unlocked" navigate={navigate} />,
    );

    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS - 1);
    expect(services.session.state).toBe("unlocked");

    await vi.advanceTimersByTimeAsync(1);
    expect(services.session.state).toBe("signed_in_locked");
    expect(services.vault.isUnlocked).toBe(false);
    expect(visited).toEqual([LOCKED_PATH]);
  });

  it("input keeps the app unlocked", async () => {
    const services = await unlocked();
    vi.useFakeTimers();
    render(
      <Harness
        services={services}
        state="unlocked"
        navigate={() => undefined}
      />,
    );

    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS - 1_000);
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS - 1_000);

    expect(services.session.state).toBe("unlocked");
  });

  it("runs no timer while locked or signed out, and stops when the app locks", async () => {
    const services = await unlocked();
    vi.useFakeTimers();
    const view = render(
      <Harness
        services={services}
        state="signed_in_locked"
        navigate={() => undefined}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);

    view.rerender(
      <Harness
        services={services}
        state="unlocked"
        navigate={() => undefined}
      />,
    );
    expect(vi.getTimerCount()).toBe(1);

    view.rerender(
      <Harness
        services={services}
        state="signed_out"
        navigate={() => undefined}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
