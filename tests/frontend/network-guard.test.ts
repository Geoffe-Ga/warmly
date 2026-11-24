import { describe, expect, it } from "vitest";

import { NetworkAccessError, installNetworkGuard } from "./setup";

describe("unit-test network guard (AC-03)", () => {
  it.each([
    ["a string URL", "https://api.openai.com/v1/responses"],
    ["a URL object", new URL("https://api.anthropic.com/v1/messages")],
    ["a Request", new Request("https://rogue.example/collect")],
  ])("fetch throws for %s", (_label, input) => {
    expect(() => fetch(input)).toThrow(NetworkAccessError);
  });

  it("names the API and the target so the failure is easy to fix", () => {
    expect(() => fetch("https://rogue.example/collect")).toThrow(
      /fetch was called for https:\/\/rogue\.example\/collect/,
    );
  });

  it("describes a target it cannot read", () => {
    expect(() => fetch({} as RequestInfo)).toThrow(/an unknown target/);
  });

  it("blocks XMLHttpRequest", () => {
    expect(() => new XMLHttpRequest()).toThrow(NetworkAccessError);
  });

  it("blocks WebSocket", () => {
    expect(() => new WebSocket("wss://rogue.example/socket")).toThrow(
      /WebSocket was called for wss:\/\/rogue\.example\/socket/,
    );
  });

  it("blocks sendBeacon", () => {
    expect(() =>
      navigator.sendBeacon(new URL("https://rogue.example/beacon")),
    ).toThrow(/sendBeacon was called for https:\/\/rogue\.example\/beacon/);
  });

  it("installs on an environment that has no navigator", () => {
    const bare = {} as typeof globalThis;

    installNetworkGuard(bare);

    expect(() => bare.fetch("https://rogue.example")).toThrow(
      NetworkAccessError,
    );
  });
});
