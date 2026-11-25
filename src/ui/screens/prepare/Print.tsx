import type { JSX } from "preact";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { readingText } from "../../../domain/cards/types";
import { Button } from "../../components/Button";
import { PageLayout } from "../../components/PageLayout";
import { useCollection, type OpenCollection } from "./Collection";
import { FailedNotice, LoadingNotice, MissingNotice } from "./shared";

function Sheet(props: OpenCollection): JSX.Element {
  const { collection, cards } = props;
  if (cards.length === 0) {
    return <p>This collection has no cards to print yet.</p>;
  }
  return (
    <>
      <section class="print-sheet" aria-label="What will be printed">
        <h2>{collection.name}</h2>
        <ol class="print-sheet__cards">
          {cards.map((card) => (
            // Only the words to say: no journal text, no notes on where a
            // card came from, nothing about the account (PRD CC-013).
            <li key={card.id}>{readingText(card)}</li>
          ))}
        </ol>
      </section>
      <div class="button-row">
        <Button
          variant="primary"
          onClick={() => {
            window.print();
          }}
        >
          Print
        </Button>
      </div>
    </>
  );
}

/**
 * A printable copy of one collection: the card text and nothing else (PRD
 * CC-013). Printing happens only when the person presses Print, through
 * the browser's own print dialog. Nothing is sent anywhere to make it.
 *
 * @param props - The route's parameters; `id` names the collection.
 * @returns The print screen.
 */
export function Print(props: { readonly params: RouteParams }): JSX.Element {
  const { cards } = useServices();
  const loaded = useCollection(cards, props.params["id"]);
  const open = loaded.kind === "ready" ? loaded.value : undefined;

  return (
    <PageLayout title="Print">
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" && open === undefined && (
        <MissingNotice what="collection" />
      )}
      {open !== undefined && <Sheet {...open} />}
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
