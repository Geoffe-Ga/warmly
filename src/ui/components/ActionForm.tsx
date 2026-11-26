/**
 * Running an async action from a form: busy while it runs, a user-facing
 * error if it fails, and a form that validates before it submits. Used by
 * every screen that saves or sends something.
 */
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { describeError } from "../error-messages";

import { StatusBanner } from "./StatusBanner";

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

/** Props for {@link ActionForm}. */
export interface ActionFormProps {
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
 * @param props - See {@link ActionFormProps}.
 * @returns The form.
 */
export function ActionForm(props: ActionFormProps): JSX.Element {
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
