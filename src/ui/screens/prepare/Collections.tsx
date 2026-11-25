import type { JSX } from "preact";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import type { CardCollection } from "../../../domain/cards/types";
import { PageLayout } from "../../components/PageLayout";
import { FailedNotice, LoadingNotice, useLoaded } from "./shared";

function countLabel(count: number): string {
  return count === 1 ? "1 card" : `${String(count)} cards`;
}

function CollectionList(props: {
  readonly collections: readonly CardCollection[];
}): JSX.Element {
  if (props.collections.length === 0) {
    return <p>You have no collections yet.</p>;
  }
  return (
    <nav aria-label="Your collections">
      <ul class="action-list">
        {props.collections.map((collection) => (
          <li key={collection.id}>
            <Link
              href={pathFor("collection", { id: collection.id })}
              class="action"
            >
              {collection.name}
              <span class="action__detail">
                {countLabel(collection.cardIds.length)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Prepare for a Conversation: the person's private collections of cards
 * (PRD CC-001). Opening this screen never calls AI.
 *
 * @returns The collections screen.
 */
export function Collections(): JSX.Element {
  const { cards } = useServices();
  const loaded = useLoaded(() => cards.collections(), "collections");

  return (
    <PageLayout
      title="Prepare for a Conversation"
      lead="Cards hold what you want to say, in your words. They are private to you."
    >
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" && <CollectionList collections={loaded.value} />}
    </PageLayout>
  );
}
