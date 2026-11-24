/**
 * Pieces shared by the account screens: running an async action with a busy
 * state and a user-facing error, and the wording for each failure.
 */
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { AuthError } from "../../../auth/auth-client";
import { VaultError } from "../../../crypto/key-vault";
import { StatusBanner } from "../../components/StatusBanner";

const MESSAGES: Readonly<Record<string, string>> = {
  invalid_credentials:
    "That email and password don't match. Check both and try again, or reset your password.",
  email_not_verified:
    "Your email isn't verified yet. Open the link we sent you, then try again.",
  wrong_recovery_key:
    "That recovery key didn't work. Check each group of characters and try again.",
  no_keys_on_device:
    "This device can't unlock on its own. Use your recovery key instead.",
  unavailable:
    "Accounts aren't available in this version of Warmly yet. Nothing was sent or saved.",
};

const UNEXPECTED =
  "Something went wrong and nothing was changed. Try again in a moment.";

/**
 * Turn a failure into words for the user: what happened and what to do next.
 * Unknown failures get a generic message; their detail is never shown, since
 * it could contain something private.
 *
 * @param error - Whatever was thrown.
 * @returns A sentence or two to show in an alert.
 */
export function describeError(error: unknown): string {
  if (error instanceof AuthError || error instanceof VaultError) {
    return MESSAGES[error.code] ?? UNEXPECTED;
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
