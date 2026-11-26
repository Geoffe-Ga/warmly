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
import { StaleRecordError } from "../../../storage/record-store";
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

  useEffect(() => {
    let mounted = true;
    const saver = new Autosave<EntryContent>(
      draftSaver({
        put: (next) => records.put("journal-entry", next),
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

    const flush = (): Promise<void> => saver.flush();
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
        await records.put("journal-entry", entry);
        draft.current = undefined;
        return entry;
      } catch (error) {
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
    discard: async () => {
      await settle();
      const discarded = draft.current;
      if (discarded !== undefined) {
        // Forgotten first: whatever happens next, nothing may be saved onto
        // the deleted draft's ID.
        draft.current = undefined;
        // While the draft is being deleted the form has no draft, so a
        // save would start a second one. Nothing is saved until it is
        // known whether the draft is gone; what is typed meanwhile is held.
        discarding.current = true;
        try {
          await deleteEntry({ records, events }, discarded.id);
        } catch (error) {
          // The draft was not deleted, as far as this form knows. If the
          // store still holds it as a draft, it is this form's draft
          // again: what is typed next goes onto it, and discarding can be
          // tried again. Otherwise it would sit in storage with no form
          // offering it. What is on the form is left as it is.
          draft.current = await stillADraft(discarded.id);
          // What was typed while that was being found out is saved now,
          // onto the draft if it is still one.
          const held = typedMeanwhile.current;
          typedMeanwhile.current = undefined;
          discarding.current = false;
          if (held !== undefined) {
            autosave.current?.changed(held);
          }
          throw error;
        }
        // The draft is gone and the form is emptied, so what was typed
        // while it was going is discarded with it, as the person asked.
        typedMeanwhile.current = undefined;
        discarding.current = false;
      }
      setContent(BLANK);
      setResumed(undefined);
      setHasDraft(false);
      setSaveState("idle");
      setOutOfDate(false);
    },
  };
}
