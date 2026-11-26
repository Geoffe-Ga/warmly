/**
 * The wording for each failure a screen can show: what happened and what
 * to do next. Unknown failures get a generic message; their detail is
 * never shown, since it could contain something private.
 */
import { ApiError, type ApiErrorCode } from "../api/client";
import { AuthError, type AuthErrorCode } from "../auth/auth-client";
import { VaultError, type VaultErrorCode } from "../crypto/key-vault";
import { PairingError, type PairingErrorCode } from "../devices/pairing";
import {
  DeviceError,
  MAX_DEVICE_NAME_LENGTH,
  type DeviceErrorCode,
} from "../devices/this-device";

import { describeStorageError } from "./storage-messages";

// Keyed by every error code, so adding a code without wording is a type error.
const MESSAGES: Readonly<
  Record<
    | AuthErrorCode
    | VaultErrorCode
    | ApiErrorCode
    | DeviceErrorCode
    | PairingErrorCode,
    string
  >
> = {
  invalid_credentials:
    "That email and password don't match. Check both and try again, or reset your password.",
  email_not_verified:
    "Your email isn't verified yet. Open the link we sent you, then try again.",
  wrong_recovery_key:
    "That recovery key didn't work. Check each group of characters and try again.",
  recovery_key_mistyped:
    "That key has a typo somewhere. Compare each group with the one you saved and try again.",
  recovery_key_malformed:
    "That doesn't look like a recovery key. It is 14 groups of 4 letters and numbers.",
  no_keys_on_device:
    "This device can't unlock on its own. Use your recovery key instead.",
  wrong_device_passphrase:
    "That passphrase didn't unlock this device. Check it and try again, or use your recovery key instead.",
  device_locked_out:
    "That was too many wrong passphrases, so this device is no longer trusted. Nothing is lost. Unlock with your recovery key, and you can set a new passphrase.",
  device_store_damaged:
    "This device's saved key can't be used any more, so it has been removed. Use your recovery key to unlock; you can then set this device up again.",
  nothing_to_trust:
    "That step has expired. Unlock with your recovery key to set this device up.",
  no_account_keys:
    "This account hasn't finished setting up yet. Sign out and sign in again to create your recovery key.",
  keys_already_exist:
    "This account was already set up on another device. Sign in again and unlock with the recovery key you saved there.",
  recovery_key_changed_elsewhere:
    "Your recovery key was replaced from another device just now, so this one wasn't saved. Your existing key still works. Start again if you still want a new one.",
  nothing_to_confirm:
    "That step has expired, and nothing was changed. Start again.",
  signed_out:
    "You've been signed out. Sign in again to continue. Nothing was changed.",
  weak_password:
    "That password is too easy to guess. Choose a longer or less common one.",
  rate_limited:
    "Too many attempts in a short time. Wait a few minutes, then try again.",
  offline:
    "We couldn't reach Warmly. Check your connection and try again. Nothing was changed.",
  reset_link_invalid:
    "This reset link has expired or was already used. Ask for a new one and open it on this device.",
  device_not_authorized:
    "This device isn't registered with your account. Lock Warmly, unlock it with your recovery key, and try again. Nothing was changed.",
  device_revoked:
    "This device has been removed from your account, so it can no longer sync or open your journal.",
  reauthentication_required:
    "Your password needs to be entered again for this. Type it and try once more. Nothing was changed.",
  clock_wrong:
    "This device's clock looks wrong, so the request was refused. Set the date and time to automatic, then try again. Nothing was changed.",
  unexpected:
    "Something went wrong and nothing was changed. Try again in a moment.",
  locked: "Warmly is locked. Unlock it and try again. Nothing was changed.",
  not_found:
    "That device is no longer on your account. Reload the list to see your current devices.",
  invalid_name: `Give the device a name of 1 to ${String(MAX_DEVICE_NAME_LENGTH)} characters.`,
  pairing_expired:
    "That request ran out of time, or a newer one replaced it. Nothing was shared. Start again on the new device.",
  pairing_rejected:
    "The other device didn't approve this request. Nothing was shared. If that was you, start again and type the code carefully.",
  pairing_tampered:
    "The messages between your two devices didn't arrive as they were sent, so we stopped. Nothing was shared. Try again, or use your recovery key instead.",
  pairing_code_mismatch:
    "That isn't the code on the new device, so the request was cancelled. Nothing was shared. Start again on the new device, and type the code it shows.",
  pairing_confirmation_mismatch:
    "That isn't the confirmation code on your other device, so this device did not keep what it was sent. Start again, and if it happens twice, use your recovery key instead.",
  pairing_cancelled: "That request was cancelled. Nothing was shared.",
  unavailable:
    "Accounts aren't available in this version of Warmly yet. Nothing was sent or saved.",
};

const UNEXPECTED = MESSAGES.unexpected;

/**
 * Turn a failure into words for the user: what happened and what to do next.
 * Unknown failures get a generic message; their detail is never shown, since
 * it could contain something private.
 *
 * @param error - Whatever was thrown.
 * @returns A sentence or two to show in an alert.
 */
export function describeError(error: unknown): string {
  const storage = describeStorageError(error, "save");
  if (storage !== undefined) {
    return storage;
  }
  if (
    error instanceof AuthError ||
    error instanceof VaultError ||
    error instanceof ApiError ||
    error instanceof PairingError ||
    error instanceof DeviceError
  ) {
    return MESSAGES[error.code];
  }
  return UNEXPECTED;
}
