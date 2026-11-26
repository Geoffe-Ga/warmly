import { Fragment, type JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import {
  CARD_TYPE_LABELS,
  readingText,
  type CardCollection,
  type ConversationCard,
} from "../../../domain/cards/types";
import {
  firstQuestion,
  type ReflectSession,
} from "../../../domain/reflect/types";
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
import {
  AFTER_PROMPTS,
  type PostConversationReflection,
} from "../../../domain/post-conversation/types";
import { ConflictGoneError } from "../../../sync/conflicts";
import { formatEntryDate } from "../journal/shared";
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

function exchangeCount(session: ReflectSession): string {
  const asked = session.messages.filter(
    (message) => message.role === "question",
  ).length;
  const count = asked === 1 ? "1 question" : `${String(asked)} questions`;
  return session.status === "finished" ? `${count}, finished` : count;
}

function SessionVersion(props: {
  readonly heading: string;
  readonly session: ReflectSession;
}): JSX.Element {
  return (
    <Card heading={props.heading}>
      <p class="card-reading">{firstQuestion(props.session)}</p>
      <p class="hint">{exchangeCount(props.session)}</p>
    </Card>
  );
}

/** One version of what was written after a conversation, in full. */
function AfterVersion(props: {
  readonly heading: string;
  readonly after: PostConversationReflection;
}): JSX.Element {
  return (
    <Card heading={props.heading}>
      {AFTER_PROMPTS.map((prompt) => (
        <Fragment key={prompt.key}>
          <p class="hint">{prompt.label}</p>
          <p class="card-reading">
            {props.after.responses[prompt.key].trim() === ""
              ? "Nothing written."
              : props.after.responses[prompt.key]}
          </p>
        </Fragment>
      ))}
      <p class="hint">{formatEntryDate(props.after.entryDate)}</p>
    </Card>
  );
}

function Version(props: {
  readonly heading: string;
  readonly conflict: CardsConflict;
  readonly which: "mine" | "theirs";
}): JSX.Element | null {
  const { conflict, which } = props;
  if (conflict.record === "reflect-session") {
    const session = conflict[which];
    return session === undefined ? null : (
      <SessionVersion heading={props.heading} session={session} />
    );
  }
  if (conflict.record === "post-conversation") {
    const after = conflict[which];
    return after === undefined ? null : (
      <AfterVersion heading={props.heading} after={after} />
    );
  }
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

/** What each kind of record is called, in the middle of a sentence. */
const NAMES = {
  "card-collection": "collection",
  "conversation-card": "card",
  "reflect-session": "reflection",
  "post-conversation": "piece of writing",
} as const;

/** What is said when both versions exist. */
const EDITED = {
  "card-collection":
    "This collection was changed here and on another device. Whichever you keep, no card is lost: cards are kept separately from the collection's name and order.",
  "conversation-card": "This card was changed here and on another device.",
  "reflect-session":
    "This reflection was added to, or finished, here and on another device. The version you do not keep is removed, with any questions and answers only it has.",
  "post-conversation":
    "What you wrote after a conversation was changed here and on another device. Read both before you choose: the version you do not keep is removed.",
} as const;

/** What is said when the other device deleted it. */
const DELETED_ELSEWHERE = {
  "card-collection":
    "This collection was deleted on another device after you changed it here. A deleted collection does not come back. You can keep yours as a new collection, which starts with no cards, or let it go.",
  "conversation-card": `This card was deleted on another device after you changed it here. A deleted card does not come back. You can keep your words as a new card, or let it go. If its collection is gone too, the new card goes into a collection called "${KEPT_CARDS_NAME}".`,
  "reflect-session":
    "This reflection was deleted on another device after you added to it here. A deleted reflection does not come back. You can keep yours as a new reflection, with all of its questions and answers, or let it go.",
  "post-conversation":
    "What you wrote after a conversation was deleted on another device after you changed it here. Something deleted does not come back. You can keep your words as a new piece of writing, or let them go.",
} as const;

/** What each kind of difference is, in a sentence. */
function explain(conflict: CardsConflict): string {
  const what = NAMES[conflict.record];
  switch (conflict.kind) {
    case "edited":
      return EDITED[conflict.record];
    case "deleted-elsewhere":
      return DELETED_ELSEWHERE[conflict.record];
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
  const what = NAMES[conflict.record];
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
  const title = `A ${what}`;

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
 * The collections, cards and reflections changed in two places, each with
 * the ways to settle it (PRD SYNC-004, SYNC-005; invariant 5). Nothing is merged or
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
