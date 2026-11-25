import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import {
  CARD_TYPE_LABELS,
  readingText,
  type CardCollection,
  type ConversationCard,
} from "../../../domain/cards/types";
import {
  ConflictChangedError,
  RecordDeletedError,
} from "../../../storage/record-store";
import {
  KEPT_CARDS_NAME,
  chooseVersion,
  keepAsNew,
  listCardConflicts,
  type CardsConflict,
} from "../../../sync/card-conflicts";
import { ConflictGoneError } from "../../../sync/conflicts";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { StatusBanner } from "../../components/StatusBanner";
import { describeStorageError } from "../../storage-messages";

/** Said when the other version changed while the person was reading. */
export const CARD_CHANGED_AGAIN =
  "The other version changed again before your choice was stored, so nothing was changed. The newer one is shown now.";

/** Said when a choice had already been made, for example in another tab. */
export const CARD_ALREADY_SETTLED =
  "That one was already settled. Nothing was changed.";

/** Said when a choice could not be stored, for a reason not understood. */
export const CARD_CHOICE_FAILED =
  "Warmly couldn't store that choice. Nothing was changed. Try again in a moment.";

function describeFailure(error: unknown): string {
  if (error instanceof ConflictChangedError) {
    return CARD_CHANGED_AGAIN;
  }
  if (
    error instanceof ConflictGoneError ||
    error instanceof RecordDeletedError
  ) {
    return CARD_ALREADY_SETTLED;
  }
  // Never the error's own text.
  return describeStorageError(error, "save") ?? CARD_CHOICE_FAILED;
}

function countLabel(count: number): string {
  return count === 1 ? "1 card listed" : `${String(count)} cards listed`;
}

function CollectionVersion(props: {
  readonly heading: string;
  readonly collection: CardCollection;
}): JSX.Element {
  return (
    <Card heading={props.heading}>
      <p class="card-reading">{props.collection.name}</p>
      <p class="hint">{countLabel(props.collection.cardIds.length)}</p>
    </Card>
  );
}

function CardVersion(props: {
  readonly heading: string;
  readonly card: ConversationCard;
}): JSX.Element {
  return (
    <Card heading={props.heading}>
      <p class="card-reading">{readingText(props.card)}</p>
      <p class="hint">{CARD_TYPE_LABELS[props.card.type]}</p>
    </Card>
  );
}

function Version(props: {
  readonly heading: string;
  readonly conflict: CardsConflict;
  readonly which: "mine" | "theirs";
}): JSX.Element | null {
  const { conflict, which } = props;
  if (conflict.record === "card-collection") {
    const collection = conflict[which];
    return collection === undefined ? null : (
      <CollectionVersion heading={props.heading} collection={collection} />
    );
  }
  const card = conflict[which];
  return card === undefined ? null : (
    <CardVersion heading={props.heading} card={card} />
  );
}

/** What each kind of difference is, in a sentence. */
function explain(conflict: CardsConflict): string {
  const what = conflict.record === "card-collection" ? "collection" : "card";
  switch (conflict.kind) {
    case "edited":
      return conflict.record === "card-collection"
        ? "This collection was changed here and on another device. Whichever you keep, no card is lost: cards are kept separately from the collection's name and order."
        : "This card was changed here and on another device.";
    case "deleted-elsewhere":
      return conflict.record === "card-collection"
        ? `This collection was deleted on another device after you changed it here. A deleted collection does not come back. You can keep yours as a new collection, which starts with no cards, or let it go.`
        : `This card was deleted on another device after you changed it here. A deleted card does not come back. You can keep your words as a new card, or let it go. If its collection is gone too, the new card goes into a collection called "${KEPT_CARDS_NAME}".`;
    case "deleted-here":
      return `You deleted this ${what} here, and it was changed on another device before the deletion reached it.`;
    case "unreadable":
      return `The other version of this ${what} was written by a newer version of Warmly than this one. Update Warmly on this device to see it. Nothing has been removed.`;
  }
}

interface Option {
  readonly label: string;
  readonly said: string;
  readonly danger?: boolean;
  readonly run: () => Promise<void>;
}

function Item(props: {
  readonly conflict: CardsConflict;
  readonly busy: boolean;
  readonly onChoose: (option: Option) => void;
}): JSX.Element {
  const { records } = useServices();
  const { conflict } = props;
  const what = conflict.record === "card-collection" ? "collection" : "card";
  const options: Option[] = [];
  if (conflict.kind === "edited") {
    options.push(
      {
        label: "Keep this device's version",
        said: `This device's version of the ${what} was kept.`,
        run: () => chooseVersion(records, conflict, "mine"),
      },
      {
        label: "Keep the other version",
        said: `The other device's version of the ${what} was kept.`,
        run: () => chooseVersion(records, conflict, "theirs"),
      },
    );
  } else if (conflict.kind === "deleted-elsewhere") {
    options.push(
      {
        label: `Keep mine as a new ${what}`,
        said: `Your version was kept as a new ${what}.`,
        run: () => keepAsNew(records, conflict),
      },
      {
        label: "Discard this version",
        said: `The ${what} was deleted here too.`,
        danger: true,
        run: () => chooseVersion(records, conflict, "theirs"),
      },
    );
  } else if (conflict.kind === "deleted-here") {
    options.push(
      {
        label: "Keep the other version",
        said: `The deletion was taken back and the other device's version was kept.`,
        run: () => chooseVersion(records, conflict, "theirs"),
      },
      {
        label: "Delete it everywhere",
        said: `The ${what} is deleted and will be deleted on your other devices.`,
        danger: true,
        run: () => chooseVersion(records, conflict, "mine"),
      },
    );
  }
  const title =
    conflict.record === "card-collection" ? "A collection" : "A card";

  return (
    <section class="conflict" aria-label={title}>
      <h2>{title}</h2>
      <p>{explain(conflict)}</p>
      <div class="versions">
        <Version heading="On this device" conflict={conflict} which="mine" />
        <Version
          heading="On your other device"
          conflict={conflict}
          which="theirs"
        />
      </div>
      <div class="button-row">
        {options.map((option) => (
          <Button
            key={option.label}
            {...(option.danger === true ? { variant: "danger" as const } : {})}
            disabled={props.busy}
            onClick={() => {
              props.onChoose(option);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

/**
 * The collections and cards changed in two places, each with the ways to
 * settle it (PRD SYNC-004, SYNC-005; invariant 5). Nothing is merged or
 * chosen for the person, and nothing is removed until they choose.
 *
 * @param props - `onCount` is told how many are waiting, so the screen
 *   around this can say whether anything needs attention.
 * @returns The section, or nothing when none are waiting and nothing was
 *   just settled.
 */
export function CardConflicts(props: {
  readonly onCount: (count: number) => void;
}): JSX.Element | null {
  const { records } = useServices();
  const { onCount } = props;
  const [conflicts, setConflicts] = useState<readonly CardsConflict[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    let current = true;
    const load = (): void => {
      listCardConflicts(records).then(
        (found) => {
          if (current) {
            setConflicts(found);
            setFailed(false);
            onCount(found.length);
          }
        },
        () => {
          if (current) {
            setFailed(true);
          }
        },
      );
    };
    load();
    const stop = records.subscribe(load);
    return () => {
      current = false;
      stop();
    };
  }, [records, onCount]);

  const choose = (option: Option): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    setDone(undefined);
    setProblem(undefined);
    option
      .run()
      .then(
        () => {
          setDone(option.said);
        },
        (error: unknown) => {
          setProblem(describeFailure(error));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  if (
    conflicts.length === 0 &&
    done === undefined &&
    problem === undefined &&
    !failed
  ) {
    return null;
  }
  return (
    <>
      {failed && (
        <StatusBanner tone="error" label="Couldn't open your cards">
          Nothing was changed. Try again in a moment.
        </StatusBanner>
      )}
      {done !== undefined && (
        <StatusBanner tone="success" label="Done">
          {done}
        </StatusBanner>
      )}
      {problem !== undefined && (
        <StatusBanner tone="error" label="Couldn't do that">
          {problem}
        </StatusBanner>
      )}
      {conflicts.map((conflict) => (
        <Item
          key={`${conflict.record}/${conflict.id}/${String(conflict.revision)}`}
          conflict={conflict}
          busy={busy}
          onChoose={choose}
        />
      ))}
    </>
  );
}
