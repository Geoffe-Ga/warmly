import type { ComponentChildren, JSX } from "preact";

/** Visual weight of a {@link Button}. */
export type ButtonVariant = "primary" | "secondary" | "danger";

/** Props for {@link Button}. */
export interface ButtonProps {
  readonly children: ComponentChildren;
  /** `primary` for the main action, `danger` for destructive ones. */
  readonly variant?: ButtonVariant;
  /** `submit` only inside a form; the default never submits by accident. */
  readonly type?: "button" | "submit";
  readonly onClick?: () => void;
  /**
   * A disabled button stays focusable and is announced as unavailable
   * (`aria-disabled`), so keyboard and screen-reader users can still find it.
   */
  readonly disabled?: boolean;
}

/**
 * The app's button. At least 44 by 44 CSS pixels, with a visible focus ring.
 *
 * @param props - See {@link ButtonProps}.
 * @returns A `<button>` element.
 */
export function Button(props: ButtonProps): JSX.Element {
  const variant = props.variant ?? "secondary";
  const disabled = props.disabled === true;
  const onClick = (event: MouseEvent): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    props.onClick?.();
  };
  return (
    <button
      type={props.type ?? "button"}
      class={`button button--${variant}`}
      aria-disabled={disabled ? "true" : undefined}
      onClick={onClick}
    >
      {props.children}
    </button>
  );
}
