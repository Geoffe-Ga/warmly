import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  CARD_TYPE_LABELS,
  readingText,
  type ConversationCard,
} from "../../../domain/cards/types";
import { deleteCard, editCard } from "../../../domain/cards/cards";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextArea } from "../../components/Field";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { DELETE_WARNING } from "../journal/Entry";
import {
  CardTypePicker,
  ChangeError,
  FailedNotice,
  LoadingNotice,
  MissingNotice,
  useChange,
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

function EditCard(props: {
  readonly card: ConversationCard;
  readonly onDeleted: () => void;
}): JSX.Element {
  const { records } = useServices();
  const { card } = props;
  const change = useChange();
  const [type, setType] = useState(card.type);
  const [text, setText] = useState(readingText(card));
  const [saved, setSaved] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <Card heading="Change this card">
      <form
        class="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSaved("");
          change.run(async () => {
            await editCard({ records }, card.id, { type, text });
            setSaved("Saved.");
          });
        }}
      >
        <TextArea
          label="What do you want to say?"
          hint="In your own words. Nothing checks or changes them."
          value={text}
          onInput={setText}
          rows={4}
        />
        <CardTypePicker value={type} onChange={setType} />
        <ChangeError change={change} />
        <p role="status" class="hint">
          {saved}
        </p>
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={change.busy}>
            Save changes
          </Button>
          <Button
            variant="danger"
            disabled={change.busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete this card
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title="Delete this card?"
        confirmLabel="Delete card"
        destructive
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          change.run(async () => {
            await deleteCard({ records }, card.id);
            props.onDeleted();
          });
        }}
      >
        <p>{DELETE_WARNING}</p>
      </ConfirmDialog>
    </Card>
  );
}

/**
 * One card: what it says, what kind it is and who wrote it (PRD CC-007,
 * CC-010). The person's own card can be changed or deleted here. Opening,
 * changing or deleting a card never calls AI.
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
  const [deleted, setDeleted] = useState(false);
  const loaded = useLoaded(
    () =>
      collectionId === undefined || cardId === undefined
        ? Promise.resolve(undefined)
        : cards.card(collectionId, cardId),
    `${collectionId ?? ""}/${cardId ?? ""}`,
    cards,
  );
  const card = loaded.kind === "ready" && !deleted ? loaded.value : undefined;

  useEffect(() => {
    // The button that had focus has gone with the card.
    if (deleted) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [deleted]);

  return (
    <PageLayout title="Card">
      {deleted && (
        <StatusBanner tone="success" label="Deleted">
          The card has been removed from this device.
        </StatusBanner>
      )}
      {!deleted && loaded.kind === "loading" && <LoadingNotice />}
      {!deleted && loaded.kind === "failed" && <FailedNotice />}
      {!deleted && loaded.kind === "ready" && card === undefined && (
        <MissingNotice what="card" />
      )}
      {card !== undefined && (
        <>
          <CardBody card={card} />
          {card.authorship === "user_owned" && (
            <EditCard
              // A newer version from elsewhere starts the form afresh.
              key={`${card.id}/${card.updatedAt}`}
              card={card}
              onDeleted={() => {
                setDeleted(true);
              }}
            />
          )}
        </>
      )}
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
