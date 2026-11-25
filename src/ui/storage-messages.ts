/**
 * What to tell the person when this device's storage fails (PRD AC-28,
 * UI-008).
 *
 * Each message says what happened, why, and what to do next, and says
 * plainly whether anything was lost. None of them shows browser error text
 * or anything the person wrote.
 */
import { StorageError, type StorageFailure } from "../storage/errors";

/** Said when what is saved cannot be opened, for a reason not understood. */
export const CANNOT_OPEN =
  "Warmly couldn't open what is saved on this device. Nothing has been changed or deleted. Close other Warmly tabs and reload this page.";

/** What was being done when storage failed. */
export type StorageTask = "open" | "save";

const KEPT = "What you typed is still on this page, so keep it open.";
const UNTOUCHED = "Nothing has been changed or deleted.";

const MESSAGES: Record<StorageTask, Record<StorageFailure, string>> = {
  open: {
    full: `Warmly couldn't open what is saved on this device, because the device has no room left. ${UNTOUCHED} Free some space on this device, then reload this page.`,
    unavailable: `This browser isn't letting Warmly use its storage, so what is saved on this device can't be opened. That happens in some private windows and when site data is turned off. ${UNTOUCHED} Open Warmly in a normal window, or allow site data for it, then reload this page.`,
    blocked: `Another Warmly tab or window is in the way, so what is saved on this device can't be opened yet. ${UNTOUCHED} Close the other Warmly tabs, then reload this page.`,
    newer: `A newer version of Warmly has been used on this device, and this version can't read what it saved. ${UNTOUCHED} Reload this page to get the latest version.`,
  },
  save: {
    full: `Warmly couldn't save this, because the device has no room left. ${KEPT} Free some space on this device, then save again.`,
    unavailable: `Warmly couldn't save this, because this browser isn't letting it use its storage. That happens in some private windows and when site data is turned off. ${KEPT} Copy anything you want to keep, then open Warmly in a normal window or allow site data for it.`,
    blocked: `Warmly couldn't save this, because another Warmly tab or window is in the way. ${KEPT} Close the other Warmly tabs, then save again.`,
    newer: `Warmly couldn't save this, because a newer version of Warmly has been used on this device. ${KEPT} Copy anything you want to keep, then reload this page to get the latest version.`,
  },
};

/**
 * Put a storage failure into words.
 *
 * @param error - Whatever was thrown.
 * @param task - What was being done.
 * @returns The message, or `undefined` if the failure is not a storage
 *   failure of a known kind.
 */
export function describeStorageError(
  error: unknown,
  task: StorageTask,
): string | undefined {
  return error instanceof StorageError ? MESSAGES[task][error.kind] : undefined;
}

/**
 * Say why what is saved could not be opened.
 *
 * @param error - Whatever was thrown.
 * @returns The specific message when the cause is known, the general one
 *   otherwise.
 */
export function describeOpenFailure(error: unknown): string {
  return describeStorageError(error, "open") ?? CANNOT_OPEN;
}
