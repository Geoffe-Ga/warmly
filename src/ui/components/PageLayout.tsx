import type { ComponentChildren, JSX } from "preact";

import { Link } from "../../app/navigation";
import { PageHeading } from "./PageHeading";

/** The way back from a screen to the one it belongs under. */
export interface BackLink {
  /** The in-app path to go back to. */
  readonly href: string;
  /** The link's words, for example "Back to your journal". */
  readonly label: string;
}

/** Props for {@link PageLayout}. */
export interface PageLayoutProps {
  /** Text of the screen's single `<h1>`. */
  readonly title: string;
  /**
   * The way back, shown above the heading so it is on screen however long
   * the page is.
   */
  readonly back?: BackLink | undefined;
  /** One sentence under the heading saying what the screen is for. */
  readonly lead?: string;
  readonly children?: ComponentChildren;
}

/**
 * Standard screen body: the way back if there is one, the page heading, an
 * optional lead sentence, and the content stacked with consistent spacing.
 *
 * @param props - See {@link PageLayoutProps}.
 * @returns The screen body.
 */
export function PageLayout(props: PageLayoutProps): JSX.Element {
  return (
    <>
      {props.back !== undefined && (
        <p class="back-link">
          <Link href={props.back.href}>{props.back.label}</Link>
        </p>
      )}
      <PageHeading>{props.title}</PageHeading>
      {props.lead !== undefined && <p class="page-lead">{props.lead}</p>}
      <div class="stack">{props.children}</div>
    </>
  );
}
