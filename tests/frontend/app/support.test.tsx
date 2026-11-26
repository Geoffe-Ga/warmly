/**
 * Telling a person plainly when their browser cannot run the app (PRD
 * UI-003; AC-28). See `docs/support/browsers.md` for what is supported.
 */
import { cleanup, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UNSUPPORTED_BROWSER,
  canSignEnrollment,
  missingFeatures,
} from "../../../src/app/support";

import { renderApp, testServices, visit } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A browser with everything the app needs. */
function complete(): Record<string, unknown> {
  return {
    crypto: {
      subtle: {},
      getRandomValues: () => undefined,
      randomUUID: () => "",
    },
    indexedDB: {},
    navigator: { serviceWorker: {}, locks: {} },
  };
}

describe("what the app needs from a browser", () => {
  it("finds nothing missing in a browser that has it all", () => {
    expect(missingFeatures(complete())).toEqual([]);
  });

  it.each([
    ["no WebCrypto", { crypto: undefined }, ["encryption"]],
    [
      "WebCrypto without its key functions, as on a page not served securely",
      { crypto: { getRandomValues: () => undefined } },
      ["encryption"],
    ],
    ["no IndexedDB", { indexedDB: undefined }, ["storage"]],
    ["no service worker", { navigator: { locks: {} } }, ["offline"]],
    [
      "nothing at all",
      { crypto: undefined, indexedDB: undefined, navigator: {} },
      ["encryption", "storage", "offline"],
    ],
  ])("names what is missing: %s", (_name, changed, missing) => {
    expect(missingFeatures({ ...complete(), ...changed })).toEqual(missing);
  });

  it("looks at the browser it is running in when given nothing", () => {
    // The test environment has WebCrypto and a stand-in IndexedDB, and no
    // service worker.
    expect(missingFeatures()).toEqual(["offline"]);
  });
});

describe("whether the browser can sign a device's enrollment (ADR-0005)", () => {
  it("can, in an engine with Ed25519", async () => {
    expect(await canSignEnrollment()).toBe(true);
  });

  it("cannot, when the engine refuses the algorithm", async () => {
    const generateKey = vi
      .fn()
      .mockRejectedValue(new DOMException("no", "NotSupportedError"));

    expect(await canSignEnrollment({ generateKey })).toBe(false);
    expect(generateKey).toHaveBeenCalledWith({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ]);
  });

  it("cannot, when there is no WebCrypto at all", async () => {
    vi.stubGlobal("crypto", undefined);

    expect(await canSignEnrollment()).toBe(false);
  });
});

describe("the notice", () => {
  it("is not shown in a browser that can keep writing private and saved", async () => {
    await renderApp("/", testServices("unlocked"));

    expect(screen.queryByText(UNSUPPORTED_BROWSER)).toBeNull();
  });

  it("is shown on every screen, signed in or not, when encryption or storage is missing", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await renderApp("/help", testServices("signed_out"));

    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain(UNSUPPORTED_BROWSER);
    expect(notice.querySelector("a")?.getAttribute("href")).toBe("/help");
  });

  it("is shown when the browser cannot make the signature a new device needs", async () => {
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(
      new DOMException("Unrecognized name.", "NotSupportedError"),
    );

    await renderApp("/help", testServices("signed_out"));

    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain(UNSUPPORTED_BROWSER);
  });

  it("says what to do, in fixed words that name no private thing", () => {
    expect(UNSUPPORTED_BROWSER).toBe(
      "This browser is missing something Warmly needs to keep your writing private and saved on this device, so Warmly may not work here. Use a current version of Safari, Chrome, Edge or Firefox, in a normal (not private) window.",
    );
  });
});
