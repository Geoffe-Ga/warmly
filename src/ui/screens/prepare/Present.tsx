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

/**
 * Where a step from one card lands: never before the first card or after
 * the last, and at the first when there are no cards at all.
 */
function clamp(at: number, by: number, count: number): number {
  return Math.max(0, Math.min(at + by, count - 1));
}

function Deck(props: OpenCollection): JSX.Element {
  const { cards } = props;
  // Where the person is in the deck lives here and nowhere else. It is not
  // stored, not put in the address or the browser's history, and not
  // reported: opening this screen again starts at the first card, and
  // nothing knows which cards were shown or for how long (PRD CC-012).
  const [index, setIndex] = useState(0);
  const count = cards.length;
  const step = (by: number): void => {
    setIndex((at) => clamp(at, by, count));
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
      // Nothing else on this screen uses the arrow keys. If a text field
      // or a scrolling area is ever added here, it must be left alone.
      event.preventDefault();
      setIndex((at) => clamp(at, by, count));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [count]);

  // The card to show, worked out once: the collection can shrink or grow
  // under the view when another device changes it.
  const at = clamp(index, 0, count);
  const card = cards[at];
  if (card === undefined) {
    return <p>This collection has no cards to present yet.</p>;
  }
  const last = count - 1;
  return (
    <>
      <p class="present-card" aria-live="polite">
        {readingText(card)}
      </p>
      {/* Announced after the card, so a screen reader says where it is. */}
      <p class="hint" aria-live="polite">
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
