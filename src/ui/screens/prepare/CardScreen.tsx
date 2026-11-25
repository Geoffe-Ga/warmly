import type { JSX } from "preact";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  CARD_TYPE_LABELS,
  readingText,
  type ConversationCard,
} from "../../../domain/cards/types";
import { Card } from "../../components/Card";
import { PageLayout } from "../../components/PageLayout";
import {
  FailedNotice,
  LoadingNotice,
  MissingNotice,
  useLoaded,
} from "./shared";

/** Who the wording belongs to, said plainly. */
const AUTHORSHIP = {
  ai_generated: "Drafted by AI from your journal. You can rewrite all of it.",
  user_owned: "Written by you.",
} as const;

function CardBody(props: { readonly card: ConversationCard }): JSX.Element {
  const { card } = props;
  return (
    <>
      <Card heading={CARD_TYPE_LABELS[card.type]}>
        <p class="card-reading">{readingText(card)}</p>
        <p class="hint">{AUTHORSHIP[card.authorship]}</p>
      </Card>
      <Card heading="Its parts">
        <ol class="segment-list" aria-label="The parts of this card">
          {card.segments.map((segment) => (
            <li key={segment.id}>
              <span class="segment-list__category">{segment.category}</span>
              {segment.text}
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

/**
 * One card: what it says, what kind it is and who wrote it (PRD CC-007).
 * Opening a card never calls AI.
 *
 * @param props - The route's parameters: `id` names the collection and
 *   `cardId` the card.
 * @returns The card screen.
 */
export function CardScreen(props: {
  readonly params: RouteParams;
}): JSX.Element {
  const { cards } = useServices();
  const collectionId = props.params["id"];
  const cardId = props.params["cardId"];
  const loaded = useLoaded(
    () =>
      collectionId === undefined || cardId === undefined
        ? Promise.resolve(undefined)
        : cards.card(collectionId, cardId),
    `${collectionId ?? ""}/${cardId ?? ""}`,
  );

  return (
    <PageLayout title="Card">
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" &&
        (loaded.value === undefined ? (
          <MissingNotice what="card" />
        ) : (
          <CardBody card={loaded.value} />
        ))}
      <p>
        {collectionId === undefined ? (
          <Link href={pathFor("prepare")}>Back to your collections</Link>
        ) : (
          <Link href={pathFor("collection", { id: collectionId })}>
            Back to the collection
          </Link>
        )}
      </p>
    </PageLayout>
  );
}
