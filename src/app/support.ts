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
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const found = (value as Record<string, unknown>)[name];
  return found !== undefined && found !== null;
}

/**
 * Work out what this browser lacks.
 *
 * - `encryption`: WebCrypto with its key functions (`subtle`), random
 *   bytes (`getRandomValues`) and `randomUUID`, which the app uses to make
 *   IDs. They are absent in very old browsers and on a page
 *   that was not served securely.
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

/**
 * Said when the browser cannot make the signature that adds a device to
 * an account. Without it an account cannot be set up here, and this
 * browser cannot be added to an existing one. Fixed words.
 */
export const CANNOT_ADD_DEVICE =
  "This browser cannot make the signature Warmly uses to add a device to an account, so you cannot set up Warmly here or add this browser to your account. Use a current version of Safari, Chrome, Edge or Firefox.";

/** Tries making an Ed25519 key; the key is thrown away. */
async function tryEd25519(
  subtle: Pick<SubtleCrypto, "generateKey"> | undefined,
): Promise<boolean> {
  if (subtle === undefined) {
    return false;
  }
  try {
    await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

// What a browser offers does not change while the page is open, so the
// page's own answer is worked out once.
let ownAnswer: Promise<boolean> | undefined;

/**
 * Whether this browser can make the signatures the app needs to add a
 * device to an account: Ed25519, which older browsers lack (ADR-0005).
 *
 * This can only be found out by trying, and trying takes a moment, so it
 * is asked separately from {@link missingFeatures}.
 *
 * @param subtle - A WebCrypto interface to try instead of the page's own.
 *   Given, it is tried every time; the page's own is tried once and the
 *   answer kept.
 * @returns Whether an Ed25519 key can be made.
 */
export function canSignEnrollment(
  subtle?: Pick<SubtleCrypto, "generateKey">,
): Promise<boolean> {
  if (subtle !== undefined) {
    return tryEd25519(subtle);
  }
  ownAnswer ??= tryEd25519(globalThis.crypto?.subtle);
  return ownAnswer;
}

/** Forget the page's answer. For tests, which change what the page offers. */
export function forgetSigningSupport(): void {
  ownAnswer = undefined;
}
