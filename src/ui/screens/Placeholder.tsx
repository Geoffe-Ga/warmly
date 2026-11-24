import type { JSX } from "preact";

import type { RouteDef } from "../../app/routes";
import { PageLayout } from "../components/PageLayout";
import { StatusBanner } from "../components/StatusBanner";

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
    <PageLayout title={props.route.title} lead={props.route.summary}>
      <StatusBanner tone="info" label="Coming soon">
        This screen is not built yet.
      </StatusBanner>
    </PageLayout>
  );
}
