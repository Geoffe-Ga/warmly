/**
 * Pieces shared by the account screens: running an async action with a busy
 * state and a user-facing error, and the wording for each failure.
 */
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, type ApiErrorCode } from "../../../api/client";
import { HOME_PATH } from "../../../app/access";
import { pathFor } from "../../../app/routes";
import { AuthError, type AuthErrorCode } from "../../../auth/auth-client";
import {
  VaultError,
  type KeyVault,
  type VaultErrorCode,
} from "../../../crypto/key-vault";
import { PairingError, type PairingErrorCode } from "../../../devices/pairing";
import {
  DeviceError,
  MAX_DEVICE_NAME_LENGTH,
  type DeviceErrorCode,
} from "../../../devices/this-device";
import { StatusBanner } from "../../components/StatusBanner";

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
    "Something changed the messages between your two devices, so we stopped. Nothing was shared. Try again on a network you trust, or use your recovery key instead.",
  pairing_code_mismatch:
    "That isn't the code on the new device, so the request was cancelled. Nothing was shared. Start again on the new device, and type the code it shows.",
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

/** State of an action started from a form. */
export interface Action {
  /** True while the action is running; buttons are unavailable meanwhile. */
  readonly busy: boolean;
  /** A message to show if the last attempt failed. */
  readonly error: string | undefined;
  /**
   * Run an action. A failure is caught and described; it never escapes.
   *
   * @param work - The async work to do.
   */
  readonly run: (work: () => Promise<void>) => void;
}

/**
 * Track one async action: busy while running, an error message if it fails.
 * A second call while busy is ignored, so a double tap cannot submit twice.
 *
 * @returns The action state and its `run` function.
 */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const running = useRef(false);

  const run = (work: () => Promise<void>): void => {
    if (running.current) {
      return;
    }
    running.current = true;
    setBusy(true);
    setError(undefined);
    work()
      .catch((caught: unknown) => {
        setError(describeError(caught));
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };

  return { busy, error, run };
}

/** Props for {@link AccountForm}. */
export interface AccountFormProps {
  readonly action: Action;
  /** Return `true` if every field is valid; set field errors otherwise. */
  readonly validate: () => boolean;
  /** Called only when validation passed. */
  readonly onValid: () => Promise<void>;
  readonly children: ComponentChildren;
}

/**
 * A form that validates before submitting. When validation fails, focus moves
 * to the first invalid field, whose error text is linked to it; a failed
 * action is announced in an alert above the fields.
 *
 * @param props - See {@link AccountFormProps}.
 * @returns The form.
 */
export function AccountForm(props: AccountFormProps): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);

  useEffect(() => {
    if (failedAttempts > 0) {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }
  }, [failedAttempts]);

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    if (props.validate()) {
      props.action.run(props.onValid);
    } else {
      setFailedAttempts((count) => count + 1);
    }
  };

  return (
    <form ref={formRef} class="stack" noValidate onSubmit={onSubmit}>
      {props.action.error !== undefined && (
        <StatusBanner tone="error" label="Couldn't continue">
          {props.action.error}
        </StatusBanner>
      )}
      {props.children}
    </form>
  );
}

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
