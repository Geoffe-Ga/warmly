import type { JSX } from "preact";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import type { CardsStore } from "../../../domain/cards/store";
import {
  CARD_TYPE_LABELS,
  readingText,
  type CardCollection,
  type ConversationCard,
} from "../../../domain/cards/types";
import { PageLayout } from "../../components/PageLayout";
import {
  FailedNotice,
  LoadingNotice,
  MissingNotice,
  useLoaded,
  type Loaded,
} from "./shared";

/** A collection together with its cards, in order. */
export interface OpenCollection {
  readonly collection: CardCollection;
  readonly cards: readonly ConversationCard[];
}

/**
 * Fetch a collection and its cards for a screen.
 *
 * @param store - The cards store.
 * @param id - The collection's ID from the route, if there is one.
 * @returns The collection and its cards, or `undefined` if it is not here.
 */
export function useCollection(
  store: CardsStore,
  id: string | undefined,
): Loaded<OpenCollection | undefined> {
  return useLoaded(async () => {
    const collection =
      id === undefined ? undefined : await store.collection(id);
    return collection === undefined
      ? undefined
      : { collection, cards: await store.cards(collection.id) };
  }, id ?? "");
}

function CardList(props: OpenCollection): JSX.Element {
  const { collection, cards } = props;
  if (cards.length === 0) {
    return <p>This collection has no cards yet.</p>;
  }
  return (
    <>
      <nav aria-label="Cards in this collection">
        <ol class="action-list">
          {cards.map((card) => (
            <li key={card.id}>
              <Link
                href={pathFor("card", { id: collection.id, cardId: card.id })}
                class="action"
              >
                {readingText(card)}
                <span class="action__detail">
                  {CARD_TYPE_LABELS[card.type]}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <nav aria-label="Use this collection">
        <ul class="action-list">
          <li>
            <Link
              href={pathFor("present", { id: collection.id })}
              class="action"
            >
              Present these cards
            </Link>
          </li>
          <li>
            <Link href={pathFor("print", { id: collection.id })} class="action">
              Print these cards
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}

/**
 * One collection: its cards in the order the person chose, and the ways to
 * present or print them (PRD CC-001, CC-010).
 *
 * @param props - The route's parameters; `id` names the collection.
 * @returns The collection screen.
 */
export function Collection(props: {
  readonly params: RouteParams;
}): JSX.Element {
  const { cards } = useServices();
  const loaded = useCollection(cards, props.params["id"]);
  const open = loaded.kind === "ready" ? loaded.value : undefined;

  return (
    <PageLayout title={open?.collection.name ?? "Collection"}>
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" && open === undefined && (
        <MissingNotice what="collection" />
      )}
      {open !== undefined && <CardList {...open} />}
      <p>
        <Link href={pathFor("prepare")}>Back to your collections</Link>
      </p>
    </PageLayout>
  );
}
