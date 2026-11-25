import type { ComponentChildren, JSX } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";

import { Button } from "./Button";

/** Props for {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  readonly open: boolean;
  /** The question being asked, for example "Delete this entry?". */
  readonly title: string;
  /** What will happen, in plain words, including anything irreversible. */
  readonly children: ComponentChildren;
  /**
   * Names the action, for example "Delete entry". Avoid a bare "OK".
   * Without it there is nothing to confirm: only the cancel button shows.
   */
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Style the confirm button as destructive. */
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const FOCUSABLE =
  'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/**
 * Keep Tab and Shift+Tab inside the dialog by wrapping at either end.
 *
 * @param event - The keydown event.
 * @param container - The dialog element.
 */
function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  const items = focusableIn(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    return;
  }
  const active = container.ownerDocument.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * The only way to confirm a destructive action in Warmly.
 *
 * It is modal: focus moves to Cancel when it opens (the safe choice), Tab is
 * trapped inside, Escape and a click on the backdrop cancel, and focus returns
 * to whatever had it before. Cancel comes first so the destructive button is
 * never the default.
 *
 * @param props - See {@link ConfirmDialogProps}.
 * @returns The dialog, or `null` when closed.
 */
export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!props.open || dialog === null) {
      return undefined;
    }
    const previous = dialog.ownerDocument.activeElement;
    focusableIn(dialog)[0]?.focus();
    return () => {
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onCancel();
    } else if (event.key === "Tab" && dialogRef.current !== null) {
      trapTab(event, dialogRef.current);
    }
  };

  const onBackdropClick = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) {
      props.onCancel();
    }
  };

  return (
    <div class="dialog-backdrop" onClick={onBackdropClick}>
      <div
        ref={dialogRef}
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{props.title}</h2>
        <div id={bodyId}>{props.children}</div>
        <div class="button-row">
          <Button onClick={props.onCancel}>
            {props.cancelLabel ?? "Cancel"}
          </Button>
          {props.confirmLabel !== undefined && (
            <Button
              variant={props.destructive === true ? "danger" : "primary"}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
