import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { readingText } from "../../../domain/cards/types";
import { Button } from "../../components/Button";
import { PageLayout } from "../../components/PageLayout";
import { useCollection, type OpenCollection } from "./Collection";
import { FailedNotice, LoadingNotice, MissingNotice } from "./shared";

/** Where an arrow key takes the deck: one card back or forward. */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

function Deck(props: OpenCollection): JSX.Element {
  const { cards } = props;
  // Where the person is in the deck lives here and nowhere else. It is not
  // stored, not put in the address or the browser's history, and not
  // reported: opening this screen again starts at the first card, and
  // nothing knows which cards were shown or for how long (PRD CC-012).
  const [index, setIndex] = useState(0);
  const last = cards.length - 1;
  const step = (by: number): void => {
    setIndex((at) => Math.min(Math.max(at + by, 0), last));
  };

  // Attached as soon as the card is on screen, so the first key press
  // is never missed.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const by = KEY_STEPS[event.key];
      // Left alone when a modifier is held: those are the browser's own
      // shortcuts, such as going back a page.
      if (
        by === undefined ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      setIndex((at) => Math.min(Math.max(at + by, 0), last));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [last]);

  const card = cards[Math.min(index, Math.max(last, 0))];
  if (card === undefined) {
    return <p>This collection has no cards to present yet.</p>;
  }
  const at = Math.min(index, last);
  return (
    <>
      <p class="present-card" aria-live="polite">
        {readingText(card)}
      </p>
      <p class="hint">
        Card {at + 1} of {cards.length}
      </p>
      <div class="button-row present-controls">
        <Button
          disabled={at === 0}
          onClick={() => {
            step(-1);
          }}
        >
          Previous card
        </Button>
        <Button
          disabled={at === last}
          onClick={() => {
            step(1);
          }}
        >
          Next card
        </Button>
      </div>
      <p class="hint">You can also use the left and right arrow keys.</p>
    </>
  );
}

/**
 * Presentation: one card at a time in large text, with next and previous
 * and the left and right arrow keys (PRD CC-012). It always opens at the
 * first card and keeps no record of which cards were shown, for how long,
 * or whether the end was reached. Closing goes back to the collection and
 * starts nothing else: no prompt, no follow-up and no AI call.
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
            Close and go back to the collection
          </Link>
        )}
      </p>
    </PageLayout>
  );
}
