import type { JSX } from "preact";

import { PageLayout } from "../components/PageLayout";

/**
 * Shown for a path that matches no route. It never echoes the path back, so
 * nothing typed into the address bar is rendered into the page.
 *
 * @returns The not-found screen.
 */
export function NotFound(): JSX.Element {
  return (
    <PageLayout
      title="Page not found"
      lead="There is nothing at this address. Use the link above to go home."
    />
  );
}
