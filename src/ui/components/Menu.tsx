import type { ComponentChildren, JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

/**
 * A button that opens a panel under it: the app's menu.
 *
 * The panel is in the page only while it is open. It closes on Escape
 * (focus goes back to the button), on a press anywhere outside it, when
 * keyboard focus moves on out of it, and when a link inside it is
 * followed. Nothing here moves or animates.
 *
 * @param props - The button's words and what the open panel holds.
 * @returns The button and, while open, the panel.
 */
export function Menu(props: {
  /** The words on the button. */
  readonly label: string;
  readonly children: ComponentChildren;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPress = (event: Event): void => {
      if (
        event.target instanceof Node &&
        root.current?.contains(event.target) !== true
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  return (
    <div
      class="menu"
      ref={root}
      onFocusOut={(event) => {
        // Tabbing on out of the menu closes it. Only when focus has gone
        // to something else on the page: a press that moves focus nowhere
        // (as on a button in Safari) is handled by the press itself.
        if (
          event.relatedTarget instanceof Node &&
          root.current?.contains(event.relatedTarget) !== true
        ) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={button}
        type="button"
        class="button button--secondary"
        aria-expanded={open ? "true" : "false"}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {props.label}
      </button>
      {open && (
        <div
          id={panelId}
          class="menu__panel"
          onClick={(event) => {
            // Following a link in the menu closes it. A button in it (Sync
            // now) leaves it open, so what it did can be seen.
            if (
              event.target instanceof Element &&
              event.target.closest("a") !== null
            ) {
              setOpen(false);
            }
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}
