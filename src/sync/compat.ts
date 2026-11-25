/**
 * Old and new versions of the app in use at the same time (PRD §8, REL-004;
 * AC-28; ADR-0006).
 *
 * Every sync request says which sync protocol version this build speaks. A
 * server that does not speak it refuses the request, changes nothing, and
 * says which versions it does speak. This device then keeps everything it
 * has, including its queued changes, stays fully usable offline, and asks
 * the person to update. Nothing is ever discarded to get past a refusal.
 */

/** The sync protocol version this build speaks. */
export const SYNC_VERSION = 1;

/** The request header that carries {@link SYNC_VERSION}. */
export const SYNC_VERSION_HEADER = "Warmly-Sync-Version";

/** The response headers that say which versions the server speaks. */
export const SYNC_MIN_HEADER = "Warmly-Sync-Min";
export const SYNC_MAX_HEADER = "Warmly-Sync-Max";

/** The status the server refuses an unsupported version with. */
export const UPGRADE_REQUIRED = 426;

/**
 * This build is older than anything the server still speaks. Sync stops
 * until the app is updated. Queued changes stay queued.
 */
export class SyncUpgradeRequiredError extends Error {
  constructor() {
    super("This version of the app is too old to sync");
    this.name = "SyncUpgradeRequiredError";
  }
}

/**
 * The server is older than this build, as happens briefly while a new
 * version is being rolled out. Nothing is wrong on this device: it tries
 * again later.
 */
export class SyncServerBehindError extends Error {
  constructor() {
    super("The server does not speak this version of sync yet");
    this.name = "SyncServerBehindError";
  }
}

function whole(value: string | null): number | undefined {
  return value !== null && /^[0-9]{1,9}$/.test(value)
    ? Number(value)
    : undefined;
}

/**
 * Work out what a version refusal means for this build.
 *
 * @param headers - The refusal's response headers.
 * @param spoken - The version this build speaks.
 * @returns The error to raise. If the server does not say which versions it
 *   speaks, or says it speaks this one, the safe reading is that this build
 *   must be updated: it stops and keeps everything.
 */
export function versionRefusal(
  headers: Headers,
  spoken: number = SYNC_VERSION,
): SyncUpgradeRequiredError | SyncServerBehindError {
  const newest = whole(headers.get(SYNC_MAX_HEADER));
  return newest !== undefined && newest < spoken
    ? new SyncServerBehindError()
    : new SyncUpgradeRequiredError();
}
