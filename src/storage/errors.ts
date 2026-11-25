/**
 * What can go wrong with this device's storage, as types the rest of the
 * app can tell apart (PRD SYNC-001, §13.6; AC-28).
 *
 * A browser reports storage trouble as a `DOMException` with a name, or
 * sometimes not at all. Everything that touches IndexedDB turns what it gets
 * into one of these, so a screen can say what happened and what to do next
 * without reading browser error text. None of these errors carries any
 * private content.
 */

/** The ways storage can fail. */
export type StorageFailure = "full" | "unavailable" | "blocked" | "newer";

/** A storage failure of a known kind. */
export class StorageError extends Error {
  /** Which kind of failure this is. */
  readonly kind: StorageFailure;

  /**
   * @param kind - Which kind of failure this is.
   * @param message - A fixed, non-private description for developers.
   */
  constructor(kind: StorageFailure, message: string) {
    super(message);
    this.name = "StorageError";
    this.kind = kind;
  }
}

/** There is no room left on the device, or the browser's quota is used up. */
export class StorageFullError extends StorageError {
  constructor() {
    super("full", "This device's storage is full");
    this.name = "StorageFullError";
  }
}

/**
 * The browser will not let the app use its database at all: IndexedDB is
 * missing or turned off, as in some private windows, or the database could
 * not be opened or used for a reason the browser did not explain.
 */
export class StorageUnavailableError extends StorageError {
  constructor() {
    super("unavailable", "The local database could not be opened");
    this.name = "StorageUnavailableError";
  }
}

/**
 * Another tab or window has the database open in a way that stops this one
 * opening it. Nothing is wrong with the data.
 */
export class StorageBlockedError extends StorageError {
  constructor() {
    super("blocked", "Another tab is holding the local database open");
    this.name = "StorageBlockedError";
  }
}

/**
 * The database was written by a newer version of the app than this one. It
 * is left untouched: reading it with older code could misread or damage it.
 */
export class NewerDatabaseError extends StorageError {
  constructor() {
    super(
      "newer",
      "The local database was written by a newer version of the app",
    );
    this.name = "NewerDatabaseError";
  }
}

/** The name a browser gave a failure, if it gave one. */
function nameOf(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
    ? error.name
    : undefined;
}

/**
 * Turn what the browser reported while a database was being opened into a
 * typed error.
 *
 * @param error - What the browser gave, which may be nothing.
 * @returns The typed error. Anything unrecognised is "unavailable".
 */
export function openFailure(error: unknown): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  switch (nameOf(error)) {
    case "VersionError":
      return new NewerDatabaseError();
    case "QuotaExceededError":
      return new StorageFullError();
    default:
      return new StorageUnavailableError();
  }
}

/**
 * Turn what the browser reported while reading or writing into a typed
 * error where it can be recognised.
 *
 * @param error - What the browser gave, which may be nothing.
 * @returns A typed error for a full device or a database that is no longer
 *   usable; otherwise `undefined`, and the caller keeps its own error.
 */
export function useFailure(error: unknown): StorageError | undefined {
  if (error instanceof StorageError) {
    return error;
  }
  switch (nameOf(error)) {
    case "QuotaExceededError":
      return new StorageFullError();
    // The database was closed under this tab, or could not be read at all.
    case "InvalidStateError":
    case "UnknownError":
      return new StorageUnavailableError();
    default:
      return undefined;
  }
}
