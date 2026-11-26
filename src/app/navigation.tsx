/**
 * Client-side navigation: the current path, a `navigate` function, and a
 * `Link` that changes screens without reloading the page.
 */
import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext } from "preact/hooks";

import { isInAppPath, normalisePath } from "./router";

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
  /**
   * Called just before the link is followed inside the app, for something
   * the next screen needs that must not go in the address.
   */
  readonly onFollow?: () => void;
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
 * left click is handled in place instead of reloading the page. The link to
 * the current screen is marked `aria-current="page"`.
 *
 * @param props - See {@link LinkProps}.
 * @returns An anchor element.
 * @throws Error if `href` is not an in-app path. Links to other sites are not
 *   supported; this fails at once rather than navigating somewhere unexpected.
 */
export function Link(props: LinkProps): JSX.Element {
  if (!isInAppPath(props.href)) {
    throw new Error(
      "Link only accepts in-app paths that start with a single /",
    );
  }
  const { path, navigate } = useContext(NavigationContext);
  const onClick = (event: MouseEvent): void => {
    if (isPlainLeftClick(event)) {
      event.preventDefault();
      props.onFollow?.();
      navigate(props.href);
    }
  };
  return (
    <a
      href={props.href}
      class={props.class}
      aria-label={props.label}
      aria-current={normalisePath(props.href) === path ? "page" : undefined}
      onClick={onClick}
    >
      {props.children}
    </a>
  );
}
