/**
 * The compose form's content and its draft: loading the draft to carry on
 * with, saving it as it is typed, and finishing or discarding it
 * (PRD JR-004, DEV-005).
 */
import { useEffect, useRef, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import {
  Autosave,
  BLANK,
  completedFrom,
  currentDraft,
  draftSaver,
  type EntryContent,
  type SaveState,
} from "../../../domain/journal/drafts";
import type { EntryDate, JournalEntry } from "../../../domain/journal/types";
import { deleteEntry } from "../../../domain/journal/delete";
import { sameValue } from "../../../domain/same";
import {
  StaleRecordError,
  type RecordStore,
} from "../../../storage/record-store";
import { describeOpenFailure } from "../../storage-messages";

/** The compose form, as the screen sees it. */
export interface DraftForm {
  /** Whether the stored draft has been looked for yet, or could not be. */
  readonly status: "loading" | "failed" | "ready";
  readonly content: EntryContent;
  /** The day of the draft that was picked up when the screen opened. */
  readonly resumed: EntryDate | undefined;
  /** Whether a draft is stored for this form. */
  readonly hasDraft: boolean;
  /** Why the stored draft could not be looked for, when `status` is failed. */
  readonly openFailure: string | undefined;
  readonly saveState: SaveState;
  /** What the last failed save threw, while `saveState` is failed. */
  readonly saveError: unknown;
  /**
   * Whether a save was refused because the draft has been changed
   * elsewhere, for example in another tab, since this screen read it.
   */
  readonly outOfDate: boolean;
  /**
   * Read the draft again and put it on the form, replacing what is typed
   * here. If the draft is gone, or was finished elsewhere, the form is
   * emptied.
   */
  readonly loadLatest: () => Promise<void>;
  /**
   * Whether loading the latest version found the draft gone: finished or
   * discarded somewhere else. The form was emptied.
   */
  readonly draftGone: boolean;
  /** Take new content from the form and save it shortly. */
  readonly change: (content: EntryContent) => void;
  /**
   * Store the form as a completed entry, in place of its draft.
   *
   * @returns The entry, or `undefined` if the app locked first.
   */
  readonly complete: () => Promise<JournalEntry | undefined>;
  /** Delete the draft and empty the form. */
  readonly discard: () => Promise<void>;
}

/**
 * Refuse to write over a draft that is no longer what the form last read
 * or stored: sync or another tab changed it while it was being typed. The
 * store's own stale-copy check does not catch a change that sync has
 * already put in the store's copy.
 *
 * @param records - The record store.
 * @param mine - The draft as the form knows it, if it has one.
 * @throws StaleRecordError if the stored draft says something else.
 */
async function refuseIfChanged(
  records: RecordStore,
  mine: JournalEntry | undefined,
): Promise<void> {
  if (mine === undefined) {
    return;
  }
  const stored = await records.get("journal-entry", mine.id);
  if (stored !== undefined && !sameValue(stored, mine)) {
    throw new StaleRecordError();
  }
}

/**
 * Hold the compose form and keep its draft saved.
 *
 * The draft is saved a moment after typing stops, when the page is hidden
 * or closed, when the screen is left, and before the app locks. Saving
 * writes to this device only and never calls AI.
 *
 * @returns The form.
 */
export function useDraft(): DraftForm {
  const { records, events, session, lockHooks } = useServices();
  const [status, setStatus] = useState<DraftForm["status"]>("loading");
  const [content, setContent] = useState<EntryContent>(BLANK);
  const [resumed, setResumed] = useState<EntryDate | undefined>(undefined);
  const [hasDraft, setHasDraft] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [outOfDate, setOutOfDate] = useState(false);
  const [openFailure, setOpenFailure] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [draftGone, setDraftGone] = useState(false);
  const draft = useRef<JournalEntry | undefined>(undefined);
  const autosave = useRef<Autosave<EntryContent> | undefined>(undefined);
  // True from the moment the entry starts being finished. Nothing typed
  // after that may be saved as a draft: the draft is turning into the
  // finished entry, and a late save would leave a second draft behind. It
  // stays true once the entry is stored, and when the app locked first:
  // either way this screen is replaced, and the hook starts afresh when the
  // form is next opened.
  const finishing = useRef(false);
  // True while a draft is being deleted, and what was typed during that.
  const discarding = useRef(false);
  const typedMeanwhile = useRef<EntryContent | undefined>(undefined);
  const discardInFlight = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const saver = new Autosave<EntryContent>(
      draftSaver({
        put: async (next) => {
          await refuseIfChanged(records, draft.current);
          await records.put("journal-entry", next);
        },
        current: () => draft.current,
        finishing: () => finishing.current,
        stored: (next) => {
          draft.current = next;
          if (mounted) {
            setHasDraft(true);
          }
        },
        refused: (error) => {
          if (mounted) {
            setOutOfDate(error instanceof StaleRecordError);
            setSaveError(error);
          }
        },
      }),
      (state) => {
        if (mounted) {
          // "Saved" is only said when something is stored.
          setSaveState(
            state === "saved" && draft.current === undefined ? "idle" : state,
          );
        }
      },
    );
    autosave.current = saver;

    void records.list("journal-entry").then(
      (entries) => {
        if (!mounted) {
          return;
        }
        const found = currentDraft(entries);
        if (found !== undefined) {
          draft.current = found;
          setContent({
            responses: found.responses,
            feelings: found.feelings ?? [],
          });
          setResumed(found.entryDate);
          setHasDraft(true);
        }
        setStatus("ready");
      },
      (error: unknown) => {
        if (mounted) {
          setOpenFailure(describeOpenFailure(error));
          setStatus("failed");
        }
      },
    );

    const flush = async (): Promise<void> => {
      // A draft that is being deleted decides where words typed meanwhile
      // go, so its outcome is waited for first. Whether it failed is the
      // discard's own business, not this save's.
      await discardInFlight.current?.catch(() => undefined);
      await saver.flush();
    };
    const whenHidden = (): void => {
      if (document.visibilityState === "hidden") {
        void flush();
      }
    };
    const whenLeaving = (): void => {
      void flush();
    };
    document.addEventListener("visibilitychange", whenHidden);
    window.addEventListener("pagehide", whenLeaving);
    const unregister = lockHooks.register(flush);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", whenHidden);
      window.removeEventListener("pagehide", whenLeaving);
      unregister();
      // Leaving the screen saves what was typed. The screen is gone, so
      // the state the save reports is deliberately ignored.
      void flush();
    };
  }, [records, lockHooks]);

  /**
   * Read a draft again from the store, after deleting it failed.
   *
   * @param id - The draft's ID.
   * @returns The draft if the store still holds it as one. `undefined` if
   *   it is gone, was finished, or cannot be read: nothing is ever saved
   *   onto an ID that might have been deleted.
   */
  const stillADraft = async (id: string): Promise<JournalEntry | undefined> => {
    try {
      const latest = await records.reload("journal-entry", id);
      return latest?.status === "draft" ? latest : undefined;
    } catch {
      return undefined;
    }
  };

  /** Stop any waiting save and wait for one that is already running. */
  const settle = async (): Promise<void> => {
    autosave.current?.cancel();
    await autosave.current?.flush();
  };

  /** Delete the form's draft and empty the form. See `discard`. */
  const runDiscard = async (): Promise<void> => {
    // From here until it is known whether the draft is gone, nothing is
    // saved: the form is about to have no draft, and a save would start a
    // second one. That includes the moment spent waiting for a save that
    // was already running. What is typed meanwhile is held, and the lock,
    // page-hidden and leaving-the-screen saves wait for this (see `flush`)
    // so that held words are not lost to them.
    discarding.current = true;
    // Whether the form ends with no draft: there was none, or it was
    // deleted.
    let gone = false;
    try {
      await settle();
      const discarded = draft.current;
      if (discarded === undefined) {
        gone = true;
      } else {
        // Forgotten first: whatever happens next, nothing may be saved
        // onto the deleted draft's ID.
        draft.current = undefined;
        try {
          await deleteEntry({ records, events }, discarded.id);
          gone = true;
        } catch (error) {
          // The draft was not deleted, as far as this form knows. If the
          // store still holds it as a draft, it is this form's draft
          // again: what is typed next goes onto it, and discarding can be
          // tried again. Otherwise it would sit in storage with no form
          // offering it. What is on the form is left as it is.
          draft.current = await stillADraft(discarded.id);
          throw error;
        }
      }
    } finally {
      const held = typedMeanwhile.current;
      typedMeanwhile.current = undefined;
      discarding.current = false;
      // The delete failed: what was typed while that was being found out
      // is saved now. It goes onto the draft if the store still holds it
      // as one; if the draft turned out to be gone or finished elsewhere,
      // it starts a new draft, since those words are still on the form.
      // When the form ends with no draft it is emptied, and what was typed
      // while the draft was going goes with it, as the person asked.
      if (!gone && held !== undefined) {
        autosave.current?.changed(held);
      }
    }
    setContent(BLANK);
    setResumed(undefined);
    setHasDraft(false);
    setSaveState("idle");
    setOutOfDate(false);
  };

  return {
    status,
    content,
    resumed,
    hasDraft,
    openFailure,
    saveState,
    saveError,
    change: (next) => {
      setContent(next);
      setDraftGone(false);
      if (discarding.current) {
        typedMeanwhile.current = next;
      } else if (!finishing.current) {
        autosave.current?.changed(next);
      }
    },
    complete: async () => {
      finishing.current = true;
      try {
        await settle();
        const entry = await completedFrom(content, draft.current);
        // Preparing the entry takes a moment. If the app locked meanwhile
        // the keys have gone, and the locked screen is already showing.
        if (session.state !== "unlocked") {
          return undefined;
        }
        await refuseIfChanged(records, draft.current);
        await records.put("journal-entry", entry);
        draft.current = undefined;
        return entry;
      } catch (error) {
        if (error instanceof StaleRecordError) {
          // The draft was changed somewhere else: the form says so and
          // offers the latest version, as when a save is refused.
          setOutOfDate(true);
          setSaveError(error);
        }
        // The entry was not stored, so the form is a draft again and the
        // next change is saved as one.
        finishing.current = false;
        throw error;
      }
    },
    outOfDate,
    loadLatest: async () => {
      await settle();
      const latest =
        draft.current === undefined
          ? undefined
          : await records.reload("journal-entry", draft.current.id);
      const found = latest?.status === "draft" ? latest : undefined;
      draft.current = found;
      setContent(
        found === undefined
          ? BLANK
          : { responses: found.responses, feelings: found.feelings ?? [] },
      );
      setResumed(found?.entryDate);
      setHasDraft(found !== undefined);
      setSaveState("idle");
      setOutOfDate(false);
      setDraftGone(found === undefined);
    },
    draftGone,
    discard: () => {
      // One at a time: pressing Discard again while a draft is going joins
      // the deletion already under way.
      discardInFlight.current ??= runDiscard().finally(() => {
        discardInFlight.current = undefined;
      });
      return discardInFlight.current;
    },
  };
}
