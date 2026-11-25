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
  draftFrom,
  isBlank,
  type EntryContent,
  type SaveState,
} from "../../../domain/journal/drafts";
import type { EntryDate, JournalEntry } from "../../../domain/journal/types";

/** The compose form, as the screen sees it. */
export interface DraftForm {
  /** Whether the stored draft has been looked for yet, or could not be. */
  readonly status: "loading" | "failed" | "ready";
  readonly content: EntryContent;
  /** The day of the draft that was picked up when the screen opened. */
  readonly resumed: EntryDate | undefined;
  /** Whether a draft is stored for this form. */
  readonly hasDraft: boolean;
  readonly saveState: SaveState;
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
  const { records, session, lockHooks } = useServices();
  const [status, setStatus] = useState<DraftForm["status"]>("loading");
  const [content, setContent] = useState<EntryContent>(BLANK);
  const [resumed, setResumed] = useState<EntryDate | undefined>(undefined);
  const [hasDraft, setHasDraft] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const draft = useRef<JournalEntry | undefined>(undefined);
  const autosave = useRef<Autosave<EntryContent> | undefined>(undefined);
  // True from the moment the entry starts being finished. Nothing typed
  // after that may be saved as a draft: the draft is turning into the
  // finished entry, and a late save would leave a second draft behind.
  const finishing = useRef(false);

  useEffect(() => {
    let mounted = true;
    const saver = new Autosave<EntryContent>(
      async (latest) => {
        // A blank form that has no draft yet is not worth one.
        if (
          finishing.current ||
          (draft.current === undefined && isBlank(latest))
        ) {
          return;
        }
        const next = await draftFrom(latest, draft.current);
        await records.put("journal-entry", next);
        draft.current = next;
      },
      (state) => {
        if (mounted) {
          setHasDraft(draft.current !== undefined);
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
      () => {
        if (mounted) {
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
    saveState,
    change: (next) => {
      setContent(next);
      if (!finishing.current) {
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
    discard: async () => {
      await settle();
      if (draft.current !== undefined) {
        await records.delete("journal-entry", draft.current.id);
        draft.current = undefined;
      }
      setContent(BLANK);
      setResumed(undefined);
      setHasDraft(false);
      setSaveState("idle");
    },
  };
}
