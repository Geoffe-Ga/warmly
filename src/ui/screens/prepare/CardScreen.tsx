import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  CARD_TYPE_LABELS,
  readingText,
  type CardSegment,
  type ConversationCard,
} from "../../../domain/cards/types";
import { deleteCard, editCard } from "../../../domain/cards/cards";
import {
  provenanceOf,
  type Provenance,
} from "../../../domain/cards/provenance";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextArea } from "../../components/Field";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { SegmentDetail } from "../../components/SegmentDetail";
import { SegmentHighlight } from "../../components/SegmentHighlight";
import { StatusBanner } from "../../components/StatusBanner";
import { DELETE_WARNING } from "../journal/Entry";
import { useJournalEntries } from "../journal/shared";
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
  ai_generated:
    "Drafted by AI from journal entries you picked. It can be wrong. It is removed if one of those entries is changed or deleted.",
  user_owned: "Written by you.",
} as const;

/** The two ways to look at a card AI drafted. */
type Mode = "conversation" | "learning";

const MODES: readonly { readonly mode: Mode; readonly label: string }[] = [
  { mode: "conversation", label: "Conversation: just the words" },
  { mode: "learning", label: "Learning: where each part comes from" },
];

/** Said above the parts in learning mode. */
export const LEARNING_LEAD =
  "Each part is a button. Press one to see which of your own words it rests on, or that it is inferred or suggested, and why the wording may help.";

function ModePicker(props: {
  readonly value: Mode;
  readonly onChange: (mode: Mode) => void;
}): JSX.Element {
  const name = useId();
  return (
    <fieldset class="choices">
      <legend class="field__label">How to show this card</legend>
      <ul class="choices__list">
        {MODES.map(({ mode, label }) => (
          <li key={mode}>
            <label class="choices__option">
              <input
                type="radio"
                name={name}
                value={mode}
                checked={props.value === mode}
                onChange={() => {
                  props.onChange(mode);
                }}
              />
              <span>{label}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** The parts of a card as buttons, one of which may have its detail open. */
function LearningParts(props: {
  readonly card: ConversationCard;
}): JSX.Element {
  const { card } = props;
  const journal = useJournalEntries();
  const entries = journal.state === "ready" ? journal.entries : [];
  const [open, setOpen] = useState<string>();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // One ID serves every part, because only one panel is open at a time.
  const panelId = useId();

  /**
   * What a part rests on. A journal that is still loading, or could not
   * be opened, is not a journal without the entry: for a part that rests
   * on the journal, that is said instead of "not on this device".
   */
  const provenance = (segment: CardSegment): Provenance => {
    const known = provenanceOf(segment, entries);
    if (journal.state === "ready" || known.kind !== "unresolved") {
      return known;
    }
    return { kind: journal.state === "loading" ? "loading" : "unknown" };
  };

  const close = (segmentId: string): void => {
    setOpen(undefined);
    // Back to the part the panel belonged to.
    buttons.current.get(segmentId)?.focus();
  };

  return (
    <Card heading="Its parts">
      <p class="hint">{LEARNING_LEAD}</p>
      <ol class="segments" aria-label="The parts of this card">
        {card.segments.map((segment) => (
          <li key={segment.id}>
            <SegmentHighlight
              segment={segment}
              open={open === segment.id}
              controls={panelId}
              buttonRef={(element) => {
                if (element === null) {
                  buttons.current.delete(segment.id);
                } else {
                  buttons.current.set(segment.id, element);
                }
              }}
              onToggle={() => {
                setOpen(open === segment.id ? undefined : segment.id);
              }}
            />
            {open === segment.id && (
              <SegmentDetail
                id={panelId}
                segment={segment}
                provenance={provenance(segment)}
                onClose={() => {
                  close(segment.id);
                }}
              />
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * A card AI drafted, in one of two modes (PRD CC-005, CC-006; AC-11).
 * Conversation mode is the card's words and nothing else. Learning mode
 * adds the parts as buttons. The mode is kept only while the screen is
 * open, and it always starts in conversation mode. Neither mode calls AI.
 */
function DraftedBody(props: { readonly card: ConversationCard }): JSX.Element {
  const { card } = props;
  const [mode, setMode] = useState<Mode>("conversation");
  return (
    <>
      <Card heading={CARD_TYPE_LABELS[card.type]}>
        <p class="card-reading">{readingText(card)}</p>
        <p class="hint">{AUTHORSHIP[card.authorship]}</p>
      </Card>
      <ModePicker value={mode} onChange={setMode} />
      {mode === "learning" && <LearningParts card={card} />}
    </>
  );
}

function CardBody(props: { readonly card: ConversationCard }): JSX.Element {
  const { card } = props;
  if (card.authorship === "ai_generated") {
    return <DraftedBody card={card} />;
  }
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
 * Deleting a card that AI drafted. It cannot be changed here yet, but it
 * is the person's to remove at any time.
 */
function DeleteDrafted(props: {
  readonly card: ConversationCard;
  readonly onDeleted: () => void;
}): JSX.Element {
  const { records } = useServices();
  const change = useChange();
  const [confirming, setConfirming] = useState(false);
  return (
    <Card heading="Delete this card">
      <ChangeError change={change} />
      <div class="button-row">
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
            await deleteCard({ records }, props.card.id);
            props.onDeleted();
          });
        }}
      >
        <p>{DELETE_WARNING}</p>
      </ConfirmDialog>
    </Card>
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
 * One card: what it says, what kind it is and who wrote it (PRD CC-005 to
 * CC-007, CC-010). The person's own card can be changed or deleted here.
 * A card AI drafted can be read plainly, or in learning mode, where each
 * part shows what it rests on. Opening, changing or deleting a card, and
 * switching mode or opening a part, never call AI.
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
          {card.authorship === "user_owned" ? (
            <EditCard
              // A newer version from elsewhere starts the form afresh.
              key={`${card.id}/${card.updatedAt}`}
              card={card}
              onDeleted={() => {
                setDeleted(true);
              }}
            />
          ) : (
            <DeleteDrafted
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
