import type { JSX } from "preact";

import type { RouteDef } from "../../app/routes";
import { PageHeading } from "../components/PageHeading";

/**
 * Stand-in for a screen that a later issue will build. It carries the real
 * title and landmark structure so navigation and accessibility checks are
 * meaningful from the first commit.
 *
 * @param props - The route this placeholder stands in for.
 * @returns The placeholder screen.
 */
export function Placeholder(props: { readonly route: RouteDef }): JSX.Element {
  return (
    <>
      <PageHeading>{props.route.title}</PageHeading>
      <p>{props.route.summary}</p>
      <p class="note">This screen is not built yet.</p>
    </>
  );
}
