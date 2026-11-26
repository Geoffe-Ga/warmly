/**
 * Pieces shared by the account screens: checking a typed recovery key,
 * where to go once keys exist, and the rules for an email and a password.
 */
import { HOME_PATH } from "../../../app/access";
import { pathFor } from "../../../app/routes";
import type { KeyVault } from "../../../crypto/key-vault";

/**
 * Check what the user typed against the last group of a recovery key shown to
 * them. Case and surrounding spaces are ignored. This only checks that they
 * copied the key down; it is not a security check.
 *
 * @param typed - What the user entered.
 * @param recoveryKey - The key as shown, in dash-separated groups.
 * @returns Whether the typed group matches.
 */
export function sameLastGroup(typed: string, recoveryKey: string): boolean {
  const lastGroup = recoveryKey.split("-").at(-1) ?? "";
  return (
    lastGroup !== "" && typed.trim().toUpperCase() === lastGroup.toUpperCase()
  );
}

/**
 * Where to go once the vault has been opened with the recovery key: to the
 * offer to trust this device if one is pending, otherwise Home.
 *
 * @param vault - The key vault.
 * @returns The path to go to.
 */
export function afterRecoveryKey(vault: KeyVault): string {
  return vault.deviceTrustPending() ? pathFor("trust-device") : HOME_PATH;
}

/** Shortest password the app accepts. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Check an email address well enough to catch typos. The server is the
 * authority; this only saves a round trip.
 *
 * @param email - What the user typed.
 * @returns An error message, or `undefined` if it looks like an address.
 */
export function emailError(email: string): string | undefined {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ? undefined
    : "Enter an email address, like name@example.com.";
}

/**
 * Check a new password against the length rule.
 *
 * @param password - What the user typed.
 * @returns An error message, or `undefined` if it is long enough.
 */
export function newPasswordError(password: string): string | undefined {
  return password.length >= MIN_PASSWORD_LENGTH
    ? undefined
    : `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
}
