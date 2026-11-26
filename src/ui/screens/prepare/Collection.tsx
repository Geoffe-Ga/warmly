import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { createCard } from "../../../domain/cards/cards";
import {
  deleteCollection,
  moveCard,
  renameCollection,
} from "../../../domain/cards/collections";
import type { CardsStore } from "../../../domain/cards/store";
import {
  CARD_TYPE_LABELS,
  readingText,
  type CardCollection,
  type CardType,
  type ConversationCard,
} from "../../../domain/cards/types";
import { Button } from "../../components/Button";
import { DangerZone } from "../../components/DangerZone";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextArea, TextField } from "../../components/Field";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { DELETE_WARNING } from "../journal/shared";
import {
  CardTypePicker,
  ChangeError,
  FailedNotice,
  LoadingNotice,
  MissingNotice,
  useChange,
  useLoaded,
  type Change,
  type Loaded,
} from "./shared";

/** A collection together with its cards, in order. */
export interface OpenCollection {
  readonly collection: CardCollection;
  readonly cards: readonly ConversationCard[];
}

/**
 * Fetch a collection and its cards for a screen, and keep them up to date.
 *
 * @param store - The cards store.
 * @param id - The collection's ID from the route, if there is one.
 * @returns The collection and its cards, or `undefined` if it is not here.
 */
export function useCollection(
  store: CardsStore,
  id: string | undefined,
): Loaded<OpenCollection | undefined> {
  return useLoaded(
    async () => {
      const collection =
        id === undefined ? undefined : await store.collection(id);
      return collection === undefined
        ? undefined
        : { collection, cards: await store.cards(collection.id) };
    },
    id ?? "",
    store,
  );
}

/** Said on a card that AI drafted and the person has not changed. */
export const DRAFTED_BY_AI = "Drafted by AI";

/** What the screen reader is told after a card moves. */
function movedText(position: number, total: number): string {
  return `Moved to position ${String(position)} of ${String(total)}.`;
}

function CardRow(props: {
  readonly collectionId: string;
  readonly card: ConversationCard;
  readonly position: number;
  readonly total: number;
  readonly busy: boolean;
  readonly onMove: (cardId: string, to: number) => void;
}): JSX.Element {
  const { card, position, total } = props;
  const text = readingText(card);
  return (
    <li
      class="card-row"
      draggable
      onDragStart={(event) => {
        // The card's ID, never its words: other programs can read this.
        event.dataTransfer?.setData("text/plain", card.id);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const moved = event.dataTransfer?.getData("text/plain") ?? "";
        if (moved !== "" && moved !== card.id) {
          props.onMove(moved, position);
        }
      }}
    >
      <Link
        href={pathFor("card", { id: props.collectionId, cardId: card.id })}
        class="action"
      >
        {text}
        <span class="action__detail">
          {CARD_TYPE_LABELS[card.type]}
          {card.authorship === "ai_generated" && `. ${DRAFTED_BY_AI}`}
        </span>
      </Link>
      <div class="button-row">
        <Button
          disabled={props.busy || position === 1}
          onClick={() => {
            props.onMove(card.id, position - 1);
          }}
        >
          Move up
          <span class="visually-hidden">
            : card {position} of {total}
          </span>
        </Button>
        <Button
          disabled={props.busy || position === total}
          onClick={() => {
            props.onMove(card.id, position + 1);
          }}
        >
          Move down
          <span class="visually-hidden">
            : card {position} of {total}
          </span>
        </Button>
      </div>
    </li>
  );
}

function CardList(
  props: OpenCollection & { readonly change: Change },
): JSX.Element {
  const { records } = useServices();
  const { collection, cards, change } = props;
  const [announcement, setAnnouncement] = useState("");

  const move = (cardId: string, to: number): void => {
    setAnnouncement("");
    change.run(async () => {
      const moved = await moveCard({ records }, collection.id, cardId, to);
      if (moved !== undefined) {
        setAnnouncement(movedText(moved.position, moved.total));
      }
    });
  };

  if (cards.length === 0) {
    return <p>This collection has no cards yet.</p>;
  }
  return (
    <>
      <nav aria-label="Cards in this collection">
        <ol class="card-rows">
          {cards.map((card, index) => (
            <CardRow
              key={card.id}
              collectionId={collection.id}
              card={card}
              position={index + 1}
              total={cards.length}
              busy={change.busy}
              onMove={move}
            />
          ))}
        </ol>
      </nav>
      <p role="status" class="hint">
        {announcement}
      </p>
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

function AddCard(props: { readonly collectionId: string }): JSX.Element {
  const { records } = useServices();
  const change = useChange();
  const [type, setType] = useState<CardType>("other");
  const [text, setText] = useState("");
  const [added, setAdded] = useState("");

  return (
    <Card heading="Write a card">
      <form
        class="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAdded("");
          change.run(async () => {
            await createCard({ records }, props.collectionId, { type, text });
            // Only once it is stored is what was typed cleared.
            setText("");
            setAdded("Card added at the end.");
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
          {added}
        </p>
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={change.busy}>
            Add card
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Manage(props: {
  readonly open: OpenCollection;
  readonly onDeleted: () => void;
}): JSX.Element {
  const { records } = useServices();
  const { collection, cards } = props.open;
  const change = useChange();
  const [name, setName] = useState(collection.name);
  // If the name changes elsewhere, the box follows it, unless the person
  // has started typing a different one.
  const [known, setKnown] = useState(collection.name);
  if (known !== collection.name) {
    setKnown(collection.name);
    if (name === known) {
      setName(collection.name);
    }
  }
  const [renamed, setRenamed] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <Card heading="Rename or delete">
      <form
        class="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setRenamed("");
          change.run(async () => {
            await renameCollection({ records }, collection.id, name);
            setRenamed("Renamed.");
          });
        }}
      >
        <TextField label="Collection name" value={name} onInput={setName} />
        <ChangeError change={change} />
        <p role="status" class="hint">
          {renamed}
        </p>
        <div class="button-row">
          <Button type="submit" disabled={change.busy}>
            Rename
          </Button>
        </div>
      </form>
      <DangerZone nested>
        <div class="button-row">
          <Button
            variant="danger"
            disabled={change.busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete this collection
          </Button>
        </div>
      </DangerZone>
      <ConfirmDialog
        open={confirming}
        title="Delete this collection and its cards?"
        confirmLabel="Delete collection"
        destructive
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          change.run(async () => {
            await deleteCollection({ records }, collection.id);
            props.onDeleted();
          });
        }}
      >
        <p>
          {cards.length === 0
            ? "This collection has no cards."
            : `Its ${cards.length === 1 ? "1 card is" : `${String(cards.length)} cards are`} deleted with it.`}
        </p>
        <p>{DELETE_WARNING}</p>
      </ConfirmDialog>
    </Card>
  );
}

/**
 * One collection: its cards in the order the person chose, with the ways
 * to add a card, move cards, rename or delete the collection, and present
 * or print it (PRD CC-001, CC-010, CC-011; AC-13). Nothing here calls AI:
 * drafting cards with AI has a screen of its own, reached by a link.
 *
 * Cards can be moved with the Move up and Move down buttons, which work
 * from the keyboard and say where the card went, or by dragging.
 *
 * @param props - The route's parameters; `id` names the collection.
 * @returns The collection screen.
 */
export function Collection(props: {
  readonly params: RouteParams;
}): JSX.Element {
  const { cards } = useServices();
  const loaded = useCollection(cards, props.params["id"]);
  const change = useChange();
  const [deleted, setDeleted] = useState(false);
  const open = loaded.kind === "ready" && !deleted ? loaded.value : undefined;

  useEffect(() => {
    // The button that had focus has gone with the collection, so focus
    // moves to the heading, above the notice that says what happened.
    if (deleted) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [deleted]);

  return (
    <PageLayout
      back={{ href: pathFor("prepare"), label: "Back to your collections" }}
      title={open?.collection.name ?? "Collection"}
    >
      {deleted && (
        <StatusBanner tone="success" label="Deleted">
          The collection and its cards have been removed from this device.
        </StatusBanner>
      )}
      {!deleted && loaded.kind === "loading" && <LoadingNotice />}
      {!deleted && loaded.kind === "failed" && <FailedNotice />}
      {!deleted && loaded.kind === "ready" && open === undefined && (
        <MissingNotice what="collection" />
      )}
      {open !== undefined && (
        <>
          <ChangeError change={change} />
          <CardList {...open} change={change} />
          <AddCard collectionId={open.collection.id} />
          <Card heading="Draft cards from your journal">
            <p>
              You pick the journal entries. Only those are sent to the AI
              provider you connected, and only after you agree.
            </p>
            <p>
              <Link href={pathFor("suggest-cards", { id: open.collection.id })}>
                Pick entries and suggest cards
              </Link>
            </p>
          </Card>
          <Manage
            key={open.collection.id}
            open={open}
            onDeleted={() => {
              setDeleted(true);
            }}
          />
        </>
      )}
    </PageLayout>
  );
}
