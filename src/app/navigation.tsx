/**
 * Client-side navigation: the current path, a `navigate` function, and a
 * `Link` that changes screens without reloading the page.
 */
import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext } from "preact/hooks";

/** What screens can read and do about navigation. */
export interface Navigation {
  /** The current, normalised pathname. */
  readonly path: string;
  /** Go to another path inside the app, adding a history entry. */
  readonly navigate: (path: string) => void;
}

/** Provided by `App`; the default is inert so a stray `Link` cannot throw. */
export const NavigationContext = createContext<Navigation>({
  path: "/",
  navigate: () => undefined,
});

/** Props for {@link Link}. */
export interface LinkProps {
  /** In-app path to navigate to. */
  readonly href: string;
  readonly children: ComponentChildren;
  /** Accessible name, when the visible text alone is not enough. */
  readonly label?: string;
  readonly class?: string;
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * An in-app link. It is a real `<a href>`, so it works with the keyboard,
 * screen readers, "open in new tab" and with JavaScript unavailable; a plain
 * left click is handled in place instead of reloading the page.
 *
 * @param props - See {@link LinkProps}.
 * @returns An anchor element.
 */
export function Link(props: LinkProps): JSX.Element {
  const { navigate } = useContext(NavigationContext);
  const onClick = (event: MouseEvent): void => {
    if (isPlainLeftClick(event)) {
      event.preventDefault();
      navigate(props.href);
    }
  };
  return (
    <a
      href={props.href}
      class={props.class}
      aria-label={props.label}
      onClick={onClick}
    >
      {props.children}
    </a>
  );
}
