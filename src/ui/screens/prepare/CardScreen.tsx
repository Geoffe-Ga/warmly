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
import {
  alternativesRequest,
  chooseAlternative,
} from "../../../domain/cards/alternatives";
import { deleteCard, editCard } from "../../../domain/cards/cards";
import { hasAiNotes, rewriteParts } from "../../../domain/cards/ownership";
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
import {
  CATEGORY_LABELS,
  SegmentHighlight,
} from "../../components/SegmentHighlight";
import { StatusBanner } from "../../components/StatusBanner";
import { DELETE_WARNING } from "../journal/shared";
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
    "Drafted by AI from journal entries you picked. It can be wrong. Until you change it, it is removed if one of those entries is changed or deleted.",
  user_owned: "Written by you.",
} as const;

/** Said of a card that is the person's own but began as an AI draft. */
export const STILL_HAS_NOTES =
  "This card is yours. Some parts still show what the AI said about them. Those notes are removed if a journal entry the card was drafted from is changed or deleted; your words are kept.";

/** Who the card belongs to and what that means, in one line. */
function whoseIsIt(card: ConversationCard): string {
  if (card.authorship === "ai_generated") {
    return AUTHORSHIP.ai_generated;
  }
  return hasAiNotes(card) ? STILL_HAS_NOTES : AUTHORSHIP.user_owned;
}

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
  const { records } = useServices();
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
                request={() => alternativesRequest(card, segment.id, entries)}
                onChoose={async (text) => {
                  try {
                    const changed = await chooseAlternative(
                      { records },
                      card.id,
                      segment.id,
                      text,
                    );
                    return changed !== undefined;
                  } catch {
                    // The panel says it was not saved. Never the error's
                    // own text.
                    return false;
                  }
                }}
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
 * What a card says and whose it is.
 *
 * A card that carries anything the AI said is shown in one of two modes
 * (PRD CC-005, CC-006; AC-11). Conversation mode is the card's words and
 * nothing else. Learning mode adds the parts as buttons. The mode is kept
 * only while the screen is open, and it always starts in conversation
 * mode. Neither mode calls AI.
 *
 * Learning mode is for anything the AI said that is still on the card,
 * whoever the card belongs to now. A person who is in learning mode when
 * the last of the AI's notes goes, for example by picking a wording in an
 * open panel, stays in it: the panel, what it says happened and their
 * place on the page are kept. A card with nothing from AI on it, looked
 * at plainly, has no mode to pick.
 */
function CardBody(props: { readonly card: ConversationCard }): JSX.Element {
  const { card } = props;
  const [mode, setMode] = useState<Mode>("conversation");
  const drafted = card.authorship === "ai_generated" || hasAiNotes(card);
  if (drafted || mode === "learning") {
    return (
      <>
        <Card heading={CARD_TYPE_LABELS[card.type]}>
          <p class="card-reading">{readingText(card)}</p>
          <p class="hint">{whoseIsIt(card)}</p>
        </Card>
        <ModePicker value={mode} onChange={setMode} />
        {mode === "learning" && <LearningParts card={card} />}
      </>
    );
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

/** Said above the form for a card that is still as AI drafted it. */
export const OWNERSHIP_NOTE =
  "Saving any change makes this card yours. It is then kept even if the journal entries it was drafted from change. A part you change loses what the AI said about it.";

/** Said above the boxes when a card's parts are changed one by one. */
export const PARTS_HINT =
  "In your own words. Nothing checks or changes them. Empty a box to remove that part.";

function EditCard(props: {
  readonly card: ConversationCard;
  readonly onDeleted: () => void;
}): JSX.Element {
  const { records } = useServices();
  const { card } = props;
  const change = useChange();
  const several = card.segments.length > 1;
  // A card with several parts starts with a box for each. The whole card
  // can be rewritten as one text instead, at any time.
  const [whole, setWhole] = useState(!several);
  const [type, setType] = useState(card.type);
  const [text, setText] = useState(readingText(card));
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      card.segments.map((segment) => [segment.id, segment.text]),
    ),
  );
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
          // This form was filled from `card`: a newer version starts the
          // form afresh (see the key where it is used). If the stored card
          // has changed and the screen has not caught up yet, the save is
          // refused instead of replacing what the person has not seen.
          const options = { seen: card };
          change.run(async () => {
            if (whole) {
              await editCard({ records }, card.id, { type, text }, options);
            } else {
              await rewriteParts(
                { records },
                card.id,
                {
                  type,
                  parts: card.segments.map((segment) => ({
                    id: segment.id,
                    text: texts[segment.id] ?? segment.text,
                  })),
                },
                options,
              );
            }
            setSaved("Saved.");
          });
        }}
      >
        {card.authorship === "ai_generated" && (
          <p class="hint">{OWNERSHIP_NOTE}</p>
        )}
        {whole ? (
          <TextArea
            label="What do you want to say?"
            hint="In your own words. Nothing checks or changes them."
            value={text}
            onInput={setText}
            rows={4}
          />
        ) : (
          <>
            <p class="hint">{PARTS_HINT}</p>
            {card.segments.map((segment, index) => (
              <TextArea
                key={segment.id}
                label={`Part ${String(index + 1)}: ${CATEGORY_LABELS[segment.category]}`}
                value={texts[segment.id] ?? ""}
                onInput={(value) => {
                  setTexts((was) => ({ ...was, [segment.id]: value }));
                }}
                rows={3}
              />
            ))}
          </>
        )}
        <CardTypePicker value={type} onChange={setType} />
        <ChangeError change={change} />
        <p role="status" class="hint">
          {saved}
        </p>
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={change.busy}>
            Save changes
          </Button>
          {several && (
            <Button
              disabled={change.busy}
              onClick={() => {
                setSaved("");
                setWhole(!whole);
              }}
            >
              {whole ? "Change the parts one by one" : "Rewrite as one text"}
            </Button>
          )}
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
 * CC-010). Any card can be changed or deleted here: part by part, or
 * rewritten as one text. Saving a change to a card AI drafted makes it
 * the person's own (decision D-15). A card that still carries anything
 * the AI said can be read plainly, or in learning mode, where each part
 * shows what it rests on. Opening, changing or deleting a card, and
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
          <EditCard
            // A newer version from elsewhere starts the form afresh.
            key={`${card.id}/${card.updatedAt}`}
            card={card}
            onDeleted={() => {
              setDeleted(true);
            }}
          />
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
