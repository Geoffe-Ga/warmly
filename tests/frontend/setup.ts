/**
 * Vitest setup.
 *
 * 1. Provide an in-memory IndexedDB so offline-storage code (PRD SYNC-001)
 *    can be unit-tested under jsdom.
 * 2. Forbid network access. Unit tests must never contact any host, so every
 *    browser networking entry point throws. A test that needs a response
 *    replaces `fetch` with its own double. This is the unit-level half of the
 *    egress guard (PRD AC-03); `e2e/fixtures/test.ts` is the browser half.
 */
import "fake-indexeddb/auto";

/** Thrown when code under test tries to reach the network. */
export class NetworkAccessError extends Error {
  constructor(api: string, target: string) {
    super(
      `Unit tests must not use the network: ${api} was called for ${target}. ` +
        "Replace it with a test double.",
    );
    this.name = "NetworkAccessError";
  }
}

function describeTarget(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input instanceof Request ? input.url : "an unknown target";
}

/**
 * Replace the networking globals with functions that throw.
 *
 * @param target - The global object to guard; the real one outside tests of
 *   this function.
 */
export function installNetworkGuard(target: typeof globalThis): void {
  target.fetch = (input: RequestInfo | URL): Promise<Response> => {
    throw new NetworkAccessError("fetch", describeTarget(input));
  };
  target.XMLHttpRequest = class {
    constructor() {
      throw new NetworkAccessError("XMLHttpRequest", "a new request");
    }
  } as unknown as typeof XMLHttpRequest;
  target.WebSocket = class {
    constructor(url: string | URL) {
      throw new NetworkAccessError("WebSocket", describeTarget(url));
    }
  } as unknown as typeof WebSocket;
  if (typeof target.navigator !== "undefined") {
    target.navigator.sendBeacon = (url: string | URL): boolean => {
      throw new NetworkAccessError("sendBeacon", describeTarget(url));
    };
  }
}

installNetworkGuard(globalThis);
