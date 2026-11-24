import type { ComponentChildren, JSX } from "preact";

/** Marks the element that receives focus after in-app navigation. */
export const PAGE_HEADING_ATTRIBUTE = "data-page-heading";

/**
 * The single `<h1>` of a screen. It is focusable by script (not by Tab) so
 * the app can move focus to it after navigation, which tells screen-reader
 * users that the screen changed.
 *
 * @param props - The heading text.
 * @returns The heading element.
 */
export function PageHeading(props: {
  readonly children: ComponentChildren;
}): JSX.Element {
  return (
    <h1 tabIndex={-1} {...{ [PAGE_HEADING_ATTRIBUTE]: "" }}>
      {props.children}
    </h1>
  );
}
