/**
 * The browser's channel between tabs, as the record store uses it
 * (ADR-0017).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TAB_CHANGED,
  browserTabChannel,
} from "../../../src/storage/tab-channel";

/** Stands in for the browser's `BroadcastChannel`. */
class FakeBroadcastChannel {
  static readonly made: FakeBroadcastChannel[] = [];
  readonly posted: unknown[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.made.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  close(): void {
    this.closed = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeBroadcastChannel.made.length = 0;
});

describe("the browser's channel between tabs", () => {
  it("is nothing in a browser that has no BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    expect(browserTabChannel("warmly-records-a")).toBeUndefined();
  });

  it("is opened under the name it is given", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

    browserTabChannel("warmly-records-a");

    expect(FakeBroadcastChannel.made.map((each) => each.name)).toEqual([
      "warmly-records-a",
    ]);
  });

  it("posts what it is given and hands on what it hears", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const channel = browserTabChannel("warmly-records-a");
    const heard: unknown[] = [];
    channel?.listen((message) => heard.push(message));
    const [made] = FakeBroadcastChannel.made;

    channel?.post(TAB_CHANGED);
    made?.onmessage?.(new MessageEvent("message", { data: TAB_CHANGED }));

    expect(made?.posted).toEqual([TAB_CHANGED]);
    expect(heard).toEqual([TAB_CHANGED]);
  });

  it("stops listening and closes when it is closed", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const channel = browserTabChannel("warmly-records-a");
    channel?.listen(() => undefined);
    const [made] = FakeBroadcastChannel.made;

    channel?.close();

    expect(made?.onmessage).toBeNull();
    expect(made?.closed).toBe(true);
  });
});
