import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import type { EntryContent } from "../../../domain/journal/drafts";
import type { JournalEntry } from "../../../domain/journal/types";
import { unanswered } from "../../../domain/journal/validation";
import {
  ConflictChangedError,
  ConflictGoneError,
  IncompleteMergeError,
  deleteAnyway,
  discardMine,
  isDeletedElsewhere,
  isDeletedHere,
  isEdited,
  keepEdited,
  keepMerged,
  keepMine,
  keepTheirs,
  listConflicts,
  saveAsNew,
  type EditedConflict,
  type EntryConflict,
} from "../../../sync/conflicts";
import { Button } from "../../components/Button";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { describeOpenFailure } from "../../storage-messages";
import { ActionForm, useAction } from "../../components/ActionForm";
import { EntryFields } from "../journal/EntryFields";
import { formatEntryDate } from "../journal/shared";
import {
  Choice,
  DeletedHereChoice,
  DeletedThere,
  Version,
} from "./ConflictViews";
import { CardConflicts } from "./CardConflicts";

/** What the screen has found. */
type Found =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "list"; readonly conflicts: readonly EntryConflict[] };

/** What is said after a choice, so the person knows it happened. */
const KEPT = {
  mine: "Kept the version from this device. The other version has been removed.",
  theirs:
    "Kept the version from your other device. The version from this device has been removed.",
  merged:
    "Saved the version you wrote. The two earlier versions have been removed.",
} as const;

/** What is said after a choice about a deleted entry. */
const SETTLED = {
  saved:
    "Saved what you wrote as a new entry. The earlier entry stays deleted.",
  discarded:
    "Removed this device's version. The entry is deleted on all your devices.",
  deleted:
    "The entry will be deleted from your other devices the next time they sync.",
  restored:
    "Kept the version from your other device. The entry is back on this device.",
} as const;

/** Said when the other version cannot be read by this version of the app. */
const UNREADABLE =
  "This entry was changed on another device by a newer version of Warmly, which this version cannot read. Your version is still on this device. Update Warmly on this device to see both.";

function contentOf(entry: JournalEntry): EntryContent {
  return { responses: entry.responses, feelings: entry.feelings ?? [] };
}

/**
 * Review entries that were changed in two places and choose what to keep
 * (PRD SYNC-004, SYNC-010; AC-16).
 *
 * Both versions are shown in full, side by side. Nothing is merged for the
 * person and neither version is removed until they choose: keep one, or
 * write one from both. The version that is not kept is then removed from
 * this device; there is no history. Nothing here calls AI.
 *
 * An entry deleted on one device and changed on another is settled here
 * too (PRD SYNC-005; AC-17). A deleted entry never comes back under its
 * ID: text written after a deletion can be saved as a new entry or let go,
 * and a deletion that has not reached the other devices can be confirmed
 * or taken back.
 *
 * @returns The review screen.
 */
export function ConflictReview(): JSX.Element {
  const { records, events, sync } = useServices();
  const action = useAction();
  const [found, setFound] = useState<Found>({ kind: "loading" });
  const [done, setDone] = useState<string | undefined>(undefined);
  const [merging, setMerging] = useState<EditedConflict | undefined>(undefined);
  const [content, setContent] = useState<EntryContent | undefined>(undefined);
  const [tried, setTried] = useState(false);
  // Whether a choice was refused because the other version changed again.
  const [changed, setChanged] = useState(false);
  // How many collections and cards are waiting, told by their own section.
  const [cardsWaiting, setCardsWaiting] = useState(0);

  const mounted = useRef(true);
  /**
   * Read the list again.
   *
   * @param showNewer - Whether an open merge form should now show the
   *   other version as it is stored. Only after the person has been told
   *   it changed: it is never swapped under them unannounced.
   */
  const refresh = useCallback(
    (showNewer = false) =>
      listConflicts(records).then(
        (conflicts) => {
          if (!mounted.current) {
            return;
          }
          setFound({ kind: "list", conflicts });
          if (showNewer) {
            // The form keeps what was typed; the version beside it is
            // replaced by the one now stored.
            setMerging((open) =>
              conflicts.filter(isEdited).find((each) => each.id === open?.id),
            );
          }
        },
        (error: unknown) => {
          if (mounted.current) {
            setFound({ kind: "failed", message: describeOpenFailure(error) });
          }
        },
      ),
    [records],
  );

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = records.subscribe(() => {
      void refresh();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [records, refresh]);

  useEffect(() => {
    // The buttons that had focus have gone with the entry they settled, so
    // focus moves to the heading and the message under it says what happened.
    if (done !== undefined || merging !== undefined || changed) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
    // Keyed on which entry is open, not on the object, so that reading the
    // list again does not take focus from someone who is typing.
  }, [done, merging?.id, changed]);

  /**
   * Store one choice, then send the result.
   *
   * @returns Whether the entry is settled. `false` means the other version
   *   changed again, nothing was stored, and the choice is still open.
   */
  const settle = async (
    said: string,
    work: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      await work();
    } catch (error) {
      if (error instanceof ConflictChangedError) {
        setDone(undefined);
        setChanged(true);
        await refresh(true);
        return false;
      }
      if (!(error instanceof ConflictGoneError)) {
        throw error;
      }
      // Settled meanwhile, for example in another tab: not an error.
      setChanged(false);
      setDone("That entry had already been settled.");
      return true;
    }
    setChanged(false);
    setDone(said);
    void sync.sync();
    return true;
  };

  /** Said when a choice was not stored because the other version moved. */
  const changedAgain = changed && (
    <StatusBanner tone="warning" label="Changed again">
      The other version was changed again while you were looking, so nothing was
      stored. The newer version is shown now. Please choose again.
    </StatusBanner>
  );

  const back = (
    <p>
      <Link href={pathFor("journal")}>Back to your journal</Link>
    </p>
  );

  if (merging !== undefined && content !== undefined) {
    const finished =
      merging.mine.status === "complete" ||
      merging.theirs.status === "complete";
    const stop = (): void => {
      setMerging(undefined);
      setContent(undefined);
      setTried(false);
    };
    return (
      <PageLayout
        title="Write one version from both"
        lead={`Your entry from ${formatEntryDate(merging.mine.entryDate)}.`}
      >
        <p>
          The form starts with this device's version. The other version is below
          it to read and copy from. Saving keeps what is in the form and removes
          both earlier versions. There is no undo.
        </p>
        {changedAgain}
        {action.error !== undefined && (
          <StatusBanner tone="error" label="Couldn't save">
            {action.error}
          </StatusBanner>
        )}
        <ActionForm
          action={action}
          validate={() => {
            setTried(true);
            return !finished || unanswered(content.responses).length === 0;
          }}
          onValid={async () => {
            let settled: boolean;
            try {
              settled = await settle(KEPT.merged, () =>
                keepMerged({ records, events }, merging, content),
              );
            } catch (error) {
              if (error instanceof IncompleteMergeError) {
                return;
              }
              throw error;
            }
            // If the other version changed again, the form stays open with
            // what was typed and the newer version beside it.
            if (settled) {
              stop();
            }
          }}
        >
          <EntryFields
            content={content}
            missing={tried && finished ? unanswered(content.responses) : []}
            onChange={setContent}
          />
          <div class="button-row">
            <Button type="submit" variant="primary" disabled={action.busy}>
              Save this version
            </Button>
            <Button disabled={action.busy} onClick={stop}>
              Go back without saving
            </Button>
          </div>
        </ActionForm>
        <Version heading="On your other device" entry={merging.theirs} />
      </PageLayout>
    );
  }

  if (found.kind !== "list") {
    return (
      <PageLayout title="Changed in two places">
        <StatusBanner
          tone={found.kind === "failed" ? "error" : "info"}
          label={
            found.kind === "failed" ? "Couldn't open your journal" : "Loading"
          }
        >
          {found.kind === "failed" ? found.message : "Getting your entries."}
        </StatusBanner>
        {back}
      </PageLayout>
    );
  }

  const { conflicts } = found;
  return (
    <PageLayout
      title="Changed in two places"
      lead={
        conflicts.length + cardsWaiting === 0
          ? "Nothing needs your attention."
          : "These were changed or deleted on this device and on another one before they could sync. Nothing is removed until you choose."
      }
    >
      {done !== undefined && (
        <StatusBanner tone="success" label="Done">
          {done}
        </StatusBanner>
      )}
      {changedAgain}
      {action.error !== undefined && (
        <StatusBanner tone="error" label="Couldn't do that">
          {action.error}
        </StatusBanner>
      )}
      {conflicts.length + cardsWaiting > 0 && (
        <p>
          Warmly never merges or picks for you. The version you do not keep is
          removed from this device and is not stored anywhere else.
        </p>
      )}
      {conflicts.map((conflict) => {
        const deps = { records, events };
        const choose = (said: string, work: () => Promise<unknown>): void => {
          action.run(async () => {
            await settle(said, work);
          });
        };
        if (isEdited(conflict)) {
          return (
            <Choice
              key={conflict.id}
              conflict={conflict}
              busy={action.busy}
              onKeep={(which) => {
                choose(KEPT[which], () =>
                  (which === "mine" ? keepMine : keepTheirs)(deps, conflict),
                );
              }}
              onMerge={() => {
                setDone(undefined);
                setContent(contentOf(conflict.mine));
                setMerging(conflict);
              }}
            />
          );
        }
        if (isDeletedElsewhere(conflict)) {
          return (
            <DeletedThere
              key={conflict.id}
              conflict={conflict}
              busy={action.busy}
              onSave={() => {
                choose(SETTLED.saved, () => saveAsNew(deps, conflict));
              }}
              onDiscard={() => {
                choose(SETTLED.discarded, () => discardMine(deps, conflict));
              }}
            />
          );
        }
        if (isDeletedHere(conflict)) {
          return (
            <DeletedHereChoice
              key={conflict.id}
              conflict={conflict}
              busy={action.busy}
              onDelete={() => {
                choose(SETTLED.deleted, () => deleteAnyway(deps, conflict));
              }}
              onKeep={() => {
                choose(SETTLED.restored, () => keepEdited(deps, conflict));
              }}
            />
          );
        }
        return (
          <StatusBanner
            key={conflict.id}
            tone="warning"
            label="Can't be read here"
          >
            {UNREADABLE}
          </StatusBanner>
        );
      })}
      <CardConflicts onCount={setCardsWaiting} />
      {back}
    </PageLayout>
  );
}
