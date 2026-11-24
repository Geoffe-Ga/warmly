import type { JSX } from "preact";

import { PageHeading } from "../components/PageHeading";

/**
 * Shown for a path that matches no route. It never echoes the path back, so
 * nothing typed into the address bar is rendered into the page.
 *
 * @returns The not-found screen.
 */
export function NotFound(): JSX.Element {
  return (
    <>
      <PageHeading>Page not found</PageHeading>
      <p>There is nothing at this address. Use the link above to go home.</p>
    </>
  );
}
