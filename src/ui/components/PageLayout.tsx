import type { ComponentChildren, JSX } from "preact";

import { PageHeading } from "./PageHeading";

/** Props for {@link PageLayout}. */
export interface PageLayoutProps {
  /** Text of the screen's single `<h1>`. */
  readonly title: string;
  /** One sentence under the heading saying what the screen is for. */
  readonly lead?: string;
  readonly children?: ComponentChildren;
}

/**
 * Standard screen body: the page heading, an optional lead sentence, and the
 * content stacked with consistent spacing.
 *
 * @param props - See {@link PageLayoutProps}.
 * @returns The screen body.
 */
export function PageLayout(props: PageLayoutProps): JSX.Element {
  return (
    <>
      <PageHeading>{props.title}</PageHeading>
      {props.lead !== undefined && <p class="page-lead">{props.lead}</p>}
      <div class="stack">{props.children}</div>
    </>
  );
}
