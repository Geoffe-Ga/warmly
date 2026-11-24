import type { JSX } from "preact";

import { Link } from "../../app/navigation";
import { PRIMARY_ACTIONS } from "../../app/routes";
import { PageHeading } from "../components/PageHeading";

/**
 * Home (PRD UX-001): exactly three primary actions and nothing unsolicited.
 * No summaries, scores, judgments or AI calls belong on this screen.
 *
 * @returns The Home screen.
 */
export function Home(): JSX.Element {
  return (
    <>
      <PageHeading>Warmly</PageHeading>
      <nav aria-label="Primary">
        <ul class="action-list">
          {PRIMARY_ACTIONS.map((action) => (
            <li key={action.path}>
              <Link href={action.path} class="action">
                {action.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
