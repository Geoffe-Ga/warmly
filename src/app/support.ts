/**
 * What the app needs from a browser, and what to say when it is not there
 * (PRD UI-003; AC-28). The supported browsers are listed in
 * `docs/support/browsers.md`.
 *
 * This looks at what the browser offers, never at its name or version: a
 * name can be wrong, and what matters is whether writing can be encrypted
 * and kept.
 */

/** Something the app needs that a browser may lack. */
export type MissingFeature = "encryption" | "storage" | "offline";

/** Said when the browser cannot encrypt or keep writing. Fixed words. */
export const UNSUPPORTED_BROWSER =
  "This browser is missing something Warmly needs to keep your writing private and saved on this device, so Warmly may not work here. Use a current version of Safari, Chrome, Edge or Firefox, in a normal (not private) window.";

function has(value: unknown, name: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[name] !== undefined &&
    (value as Record<string, unknown>)[name] !== null
  );
}

/**
 * Work out what this browser lacks.
 *
 * - `encryption`: WebCrypto with its key functions. They are absent in
 *   very old browsers and on a page that was not served securely.
 * - `storage`: IndexedDB, which some private windows turn off.
 * - `offline`: a service worker, without which the app cannot open with
 *   no connection. Everything else still works.
 *
 * @param scope - The global object to look at; the page's own by default.
 * @returns What is missing, in a fixed order. Empty when nothing is.
 */
export function missingFeatures(scope: unknown = globalThis): MissingFeature[] {
  const missing: MissingFeature[] = [];
  const crypto = has(scope, "crypto")
    ? (scope as { crypto: unknown }).crypto
    : undefined;
  if (
    !has(crypto, "subtle") ||
    !has(crypto, "getRandomValues") ||
    !has(crypto, "randomUUID")
  ) {
    missing.push("encryption");
  }
  if (!has(scope, "indexedDB")) {
    missing.push("storage");
  }
  const navigator = has(scope, "navigator")
    ? (scope as { navigator: unknown }).navigator
    : undefined;
  if (!has(navigator, "serviceWorker")) {
    missing.push("offline");
  }
  return missing;
}

/**
 * Whether the app must warn that it may not work at all here: it cannot
 * encrypt, or it cannot store.
 *
 * @param missing - What {@link missingFeatures} found.
 * @returns Whether to show {@link UNSUPPORTED_BROWSER}.
 */
export function cannotKeepWriting(missing: readonly MissingFeature[]): boolean {
  return missing.includes("encryption") || missing.includes("storage");
}
