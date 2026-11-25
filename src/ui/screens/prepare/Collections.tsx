import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  KEPT_CARDS_NAME,
  createCollection,
  deleteStrayCards,
  keepStrayCards,
} from "../../../domain/cards/collections";
import {
  readingText,
  type CardCollection,
  type ConversationCard,
} from "../../../domain/cards/types";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { DELETE_WARNING } from "../journal/Entry";
import {
  ChangeError,
  FailedNotice,
  LoadingNotice,
  useChange,
  useLoaded,
} from "./shared";

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

function NewCollection(): JSX.Element {
  const { records } = useServices();
  const change = useChange();
  const [name, setName] = useState("");
  const [made, setMade] = useState("");

  return (
    <Card heading="Start a new collection">
      <form
        class="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setMade("");
          change.run(async () => {
            await createCollection({ records }, name);
            // Only once it is stored is what was typed cleared.
            setName("");
            setMade("Collection created.");
          });
        }}
      >
        <TextField
          label="Name"
          hint="For example, who or what the conversation is about. Only you see it."
          value={name}
          onInput={setName}
        />
        <ChangeError change={change} />
        <p role="status" class="hint">
          {made}
        </p>
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={change.busy}>
            Create collection
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** What is said about cards that belong to no collection. */
export const STRAYS_EXPLAINED =
  "Their collection was deleted on one of your devices while these were being added on another. They have not been deleted.";

function strayCount(count: number): string {
  return count === 1
    ? "1 card is not in any collection"
    : `${String(count)} cards are not in any collection`;
}

/**
 * Cards that belong to no collection, with the ways to keep or delete
 * them. Nothing is done to them until the person chooses.
 */
function StrayCards(props: {
  readonly cards: readonly ConversationCard[];
}): JSX.Element | null {
  const { records } = useServices();
  const change = useChange();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");
  const { cards } = props;

  if (cards.length === 0) {
    return done === "" ? null : (
      <p role="status" class="hint">
        {done}
      </p>
    );
  }
  return (
    <Card heading={strayCount(cards.length)}>
      <p>{STRAYS_EXPLAINED}</p>
      <ul>
        {cards.map((card) => (
          <li key={card.id}>{readingText(card)}</li>
        ))}
      </ul>
      <ChangeError change={change} />
      <div class="button-row">
        <Button
          variant="primary"
          disabled={change.busy}
          onClick={() => {
            change.run(async () => {
              await keepStrayCards({ records });
              setDone(`Kept in a collection called "${KEPT_CARDS_NAME}".`);
            });
          }}
        >
          Keep them in "{KEPT_CARDS_NAME}"
        </Button>
        <Button
          variant="danger"
          disabled={change.busy}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Delete them
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete these cards?"
        confirmLabel="Delete cards"
        destructive
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          change.run(async () => {
            await deleteStrayCards({ records });
            setDone("Those cards were deleted.");
          });
        }}
      >
        <p>{DELETE_WARNING}</p>
      </ConfirmDialog>
    </Card>
  );
}

/**
 * Prepare for a Conversation: the person's private collections of cards,
 * and the way to start a new one (PRD CC-001). Cards that have ended up
 * in no collection are shown here too, never hidden. Nothing here calls
 * AI.
 *
 * @returns The collections screen.
 */
export function Collections(): JSX.Element {
  const { cards } = useServices();
  const loaded = useLoaded(() => cards.collections(), "collections", cards);
  const strays = useLoaded(() => cards.strays(), "strays", cards);

  return (
    <PageLayout
      title="Prepare for a Conversation"
      lead="Cards hold what you want to say, in your words. They are private to you."
    >
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" && <CollectionList collections={loaded.value} />}
      {strays.kind === "ready" && <StrayCards cards={strays.value} />}
      <NewCollection />
    </PageLayout>
  );
}
