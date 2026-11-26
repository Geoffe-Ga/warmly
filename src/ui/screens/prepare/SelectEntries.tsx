import type { JSX } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import type { GeneratedCard } from "../../../ai/contracts";
import type { CardsRequest } from "../../../ai/provider";
import { AiRequestController } from "../../../ai/request-controller";
import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  NothingSelectedError,
  SelectionTooLargeError,
  cardsFrom,
  cardsRequest,
  saveGenerated,
} from "../../../domain/cards/generate";
import type { ConversationCard } from "../../../domain/cards/types";
import type { JournalEntry } from "../../../domain/journal/types";
import {
  AiRequestStatus,
  useAiRequest,
} from "../../components/AiRequestStatus";
import { Button } from "../../components/Button";
import { CheckboxGroup } from "../../components/CheckboxGroup";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { describeStorageError } from "../../storage-messages";
import {
  formatEntryDate,
  inTimelineOrder,
  useJournalEntries,
} from "../journal/shared";
import { useCollection } from "./Collection";
import { FailedNotice, LoadingNotice, MissingNotice } from "./shared";

/** Said under the heading. */
export const SUGGEST_LEAD =
  "Tick the journal entries you want cards drafted from. Only the entries you tick are sent, and only after you agree. Nothing is ticked for you.";

/** Said when the button is pressed with nothing ticked. */
export const NOTHING_TICKED =
  "Tick at least one entry first. Nothing was sent.";

/** Said when the ticked entries do not fit in one request. */
export const TOO_MANY_TICKED =
  "The entries you ticked are too much for one request, so nothing was sent. Warmly never leaves one out for you. Untick some and try again.";

/** Said when there is no finished entry to tick. */
export const NO_ENTRIES =
  "You have no finished journal entries yet, so there is nothing to draft cards from. You can still write cards yourself.";

/** Said when drafted cards could not be stored. They stay on the page. */
export const CARDS_NOT_SAVED =
  "The cards came back but could not be saved on this device. They are still here. Nothing needs to be sent again.";

/** Said when the collection was deleted while the cards were on their way. */
export const COLLECTION_GONE =
  "This collection was deleted while the cards were being drafted. The cards are saved, and you can find them on your collections page.";

/** How much of an entry's first answer is shown beside its day. */
const PREVIEW = 80;

/**
 * What an entry is called in the list: its day and the start of what it
 * says, so two entries from one day can be told apart.
 */
function nameOf(entry: JournalEntry): string {
  const text = entry.responses.good.trim().replace(/\s+/g, " ");
  const start = [...text].slice(0, PREVIEW).join("");
  const more = start.length < text.length ? "…" : "";
  return `${formatEntryDate(entry.entryDate)}: ${start}${more}`;
}

/**
 * What is said once the cards are stored.
 *
 * @param count - How many cards were added.
 * @returns The sentence.
 */
export function addedText(count: number): string {
  return count === 1
    ? "1 card was drafted and added to the end of this collection. It is a starting point: read it, and rewrite or delete it as you like."
    : `${String(count)} cards were drafted and added to the end of this collection. They are starting points: read them, and rewrite or delete them as you like.`;
}

function Picker(props: {
  readonly collectionId: string;
  readonly entries: readonly JournalEntry[];
  /** Whether the collection has gone since the screen was opened. */
  readonly collectionGone: boolean;
}): JSX.Element {
  const { ai, records, lockHooks } = useServices();
  const { collectionId, entries } = props;
  // Nothing is ticked to begin with, and nothing ever ticks a box but the
  // person (PRD CC-001).
  const [ticked, setTicked] = useState<string[]>([]);
  const [problem, setProblem] = useState<string>();
  const [added, setAdded] = useState<number>();
  const [gone, setGone] = useState(false);
  const controller = useMemo(
    () =>
      new AiRequestController<CardsRequest, readonly GeneratedCard[]>(
        (request, consent, signal) =>
          ai.generateCards(request, consent, signal),
      ),
    [ai],
  );
  const state = useAiRequest(controller);

  // Leaving the screen, or locking, stops a request and forgets it.
  useEffect(
    () => () => {
      controller.reset();
    },
    [controller],
  );

  // Cards that have arrived but are not stored yet. They are kept here
  // until they are: what the person asked for is never dropped.
  const [unsaved, setUnsaved] = useState<readonly ConversationCard[]>();
  const [saveProblem, setSaveProblem] = useState<string>();

  /** Store cards that are already here. Sends nothing. */
  const save = useCallback(
    async (cards: readonly ConversationCard[]): Promise<void> => {
      setSaveProblem(undefined);
      try {
        const here = await saveGenerated({ records }, cards);
        setUnsaved(undefined);
        setTicked([]);
        setAdded(cards.length);
        setGone(!here);
      } catch (error) {
        // Never the error's own text.
        setSaveProblem(describeStorageError(error, "save") ?? CARDS_NOT_SAVED);
      }
    },
    [records],
  );

  useEffect(() => {
    if (state.phase !== "done") {
      return;
    }
    // Made into cards once, with their IDs, so storing them again after a
    // failure never makes a second copy.
    const cards = cardsFrom(state.result, state.request, collectionId);
    controller.reset();
    setUnsaved(cards);
    void save(cards);
  }, [state, controller, collectionId, save]);

  // Cards that are here but not stored yet are stored before the keys are
  // dropped, when the app locks (ADR-0004).
  const waiting = useRef<readonly ConversationCard[] | undefined>(undefined);
  useEffect(() => {
    waiting.current = unsaved;
  }, [unsaved]);
  useEffect(
    () =>
      lockHooks.register(async () => {
        if (waiting.current !== undefined) {
          await saveGenerated({ records }, waiting.current);
        }
      }),
    [lockHooks, records],
  );

  const busy =
    state.phase === "running" ||
    state.phase === "awaiting-consent" ||
    unsaved !== undefined;
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  // An entry that has gone since it was ticked is no longer ticked.
  const chosen = ticked.filter((id) => ids.includes(id));

  return (
    <form
      class="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setProblem(undefined);
        setAdded(undefined);
        try {
          // Nothing is sent here: this opens the dialog that asks first.
          controller.ask(
            cardsRequest(
              entries.filter((entry) => chosen.includes(entry.id)),
              ai.sizing(),
            ),
          );
        } catch (error) {
          if (error instanceof SelectionTooLargeError) {
            setProblem(TOO_MANY_TICKED);
          } else if (error instanceof NothingSelectedError) {
            setProblem(NOTHING_TICKED);
          } else {
            throw error;
          }
        }
      }}
    >
      <CheckboxGroup
        legend="Which entries should the cards be drafted from?"
        hint="Newest first. Each shows its day and how it starts."
        name="entries"
        options={ids}
        selected={chosen}
        labelFor={(id) => {
          const entry = entries.find((each) => each.id === id);
          return entry === undefined ? "" : nameOf(entry);
        }}
        onChange={(selected) => {
          setProblem(undefined);
          setTicked(selected);
        }}
      />
      <p role="status" class="hint">
        {chosen.length === 1
          ? "1 entry ticked."
          : `${String(chosen.length)} entries ticked.`}
      </p>
      {problem !== undefined && (
        <StatusBanner tone="error" label="Not sent">
          {problem}
        </StatusBanner>
      )}
      <div class="button-row">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || chosen.length === 0 || props.collectionGone}
        >
          Suggest cards
        </Button>
      </div>
      <AiRequestStatus controller={controller} />
      {unsaved !== undefined && saveProblem !== undefined && (
        <StatusBanner tone="error" label="Not saved">
          {saveProblem}
          <div class="button-row">
            <Button
              onClick={() => {
                void save(unsaved);
              }}
            >
              Save the cards
            </Button>
          </div>
        </StatusBanner>
      )}
      {added !== undefined && (
        <StatusBanner tone="success" label="Cards added">
          {gone ? COLLECTION_GONE : addedText(added)}
        </StatusBanner>
      )}
    </form>
  );
}

/**
 * Pick journal entries and ask AI to draft cards from them (PRD CC-001 to
 * CC-004; AC-10, AC-15).
 *
 * Nothing is ticked to begin with, and there is no way to tick everything
 * or to have entries picked for you. Opening this screen and ticking
 * boxes send nothing. Cards are asked for only by pressing the button and
 * then agreeing in the dialog, which says exactly what will be sent. The
 * request holds the ticked entries and no others. One to three cards come
 * back, are checked against those entries, and are added to the end of
 * the collection marked as drafted by AI. A failure changes nothing: the
 * ticks stay and the collection is as it was.
 *
 * @param props - The route's parameters; `id` names the collection.
 * @returns The screen.
 */
export function SelectEntries(props: {
  readonly params: RouteParams;
}): JSX.Element {
  const { cards } = useServices();
  const id = props.params["id"];
  const loaded = useCollection(cards, id);
  const journal = useJournalEntries();
  const open = loaded.kind === "ready" ? loaded.value : undefined;
  // Once the collection has been found, the picker stays on the page even
  // if the collection then goes, for example deleted on another device.
  // Cards that are on their way still have somewhere to arrive, and are
  // never dropped.
  const [found, setFound] = useState<string>();
  const openId = open?.collection.id;
  if (openId !== undefined && found !== openId) {
    setFound(openId);
  }
  const collectionGone =
    found !== undefined && loaded.kind === "ready" && open === undefined;
  const entries = useMemo(
    () =>
      journal.state === "ready"
        ? inTimelineOrder(
            journal.entries.filter((entry) => entry.status === "complete"),
          )
        : [],
    [journal],
  );

  return (
    <PageLayout title="Suggest cards" lead={SUGGEST_LEAD}>
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" && open === undefined && (
        <MissingNotice what="collection" />
      )}
      {found !== undefined && journal.state === "failed" && (
        <StatusBanner tone="error" label="Couldn't open your journal">
          {journal.message}
        </StatusBanner>
      )}
      {found !== undefined &&
        journal.state === "ready" &&
        (entries.length === 0 ? (
          <p>{NO_ENTRIES}</p>
        ) : (
          <Picker
            // A different collection starts with nothing ticked.
            key={found}
            collectionId={found}
            entries={entries}
            collectionGone={collectionGone}
          />
        ))}
      <p>
        {id === undefined ? (
          <Link href={pathFor("prepare")}>Back to your collections</Link>
        ) : (
          <Link href={pathFor("collection", { id })}>
            Back to the collection
          </Link>
        )}
      </p>
    </PageLayout>
  );
}
