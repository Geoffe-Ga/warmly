import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { readingText } from "../../../domain/cards/types";
import { Button } from "../../components/Button";
import { PageLayout } from "../../components/PageLayout";
import { useCollection, type OpenCollection } from "./Collection";
import { FailedNotice, LoadingNotice, MissingNotice } from "./shared";

function Deck(props: OpenCollection): JSX.Element {
  const { cards } = props;
  // Where the person is in the deck lives here and nowhere else. It is not
  // stored, not put in the address and not reported: opening this screen
  // again starts at the first card (PRD CC-012).
  const [index, setIndex] = useState(0);
  const card = cards[index];
  if (card === undefined) {
    return <p>This collection has no cards to present yet.</p>;
  }
  return (
    <>
      <p class="present-card" aria-live="polite">
        {readingText(card)}
      </p>
      <p class="hint">
        Card {index + 1} of {cards.length}
      </p>
      <div class="button-row">
        <Button
          disabled={index === 0}
          onClick={() => {
            setIndex(index - 1);
          }}
        >
          Previous card
        </Button>
        <Button
          disabled={index === cards.length - 1}
          onClick={() => {
            setIndex(index + 1);
          }}
        >
          Next card
        </Button>
      </div>
    </>
  );
}

/**
 * Presentation: one card at a time in large text, with next and previous
 * (PRD CC-012). It always opens at the first card and keeps no record of
 * which cards were shown, for how long, or whether the end was reached.
 *
 * @param props - The route's parameters; `id` names the collection.
 * @returns The presentation screen.
 */
export function Present(props: { readonly params: RouteParams }): JSX.Element {
  const { cards } = useServices();
  const id = props.params["id"];
  const loaded = useCollection(cards, id);
  const open = loaded.kind === "ready" ? loaded.value : undefined;

  return (
    <PageLayout title="Presentation">
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" && open === undefined && (
        <MissingNotice what="collection" />
      )}
      {open !== undefined && <Deck key={open.collection.id} {...open} />}
      <p>
        {open === undefined ? (
          <Link href={pathFor("prepare")}>Back to your collections</Link>
        ) : (
          <Link href={pathFor("collection", { id: open.collection.id })}>
            Back to the collection
          </Link>
        )}
      </p>
    </PageLayout>
  );
}
