/**
 * The edit form for a finished entry: loading the entry, keeping what is
 * typed and not yet saved, and saving or giving up the edit (PRD JR-006,
 * DEV-005; ADR-0015).
 */
import { useEffect, useRef, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import {
  Autosave,
  BLANK,
  type EntryContent,
  type SaveState,
} from "../../../domain/journal/drafts";
import { editEntry } from "../../../domain/journal/edit";
import type { JournalEntry } from "../../../domain/journal/types";
import {
  sameContent,
  type UnfinishedEdit,
} from "../../../domain/journal/unfinished";
import type { RecordStore } from "../../../storage/record-store";
import { describeOpenFailure } from "../../storage-messages";

/** What the screen has found out about the entry to edit. */
export type Found =
  | { readonly kind: "loading" | "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "entry"; readonly entry: JournalEntry };

/** Unsaved changes from an earlier visit that were put back on the form. */
export interface Recovered {
  /** Whether the entry has been changed since those changes were typed. */
  readonly entryChangedSince: boolean;
}

/** The edit form, as the screen sees it. */
export interface EditForm {
  readonly found: Found;
  readonly content: EntryContent;
  /** Set when the form opened with unsaved changes from an earlier visit. */
  readonly recovered: Recovered | undefined;
  /** Where keeping the unsaved changes stands. */
  readonly keepState: SaveState;
  /** What the last failed attempt to keep them threw. */
  readonly keepError: unknown;
  /** Take new content from the form, and keep it shortly. */
  readonly change: (content: EntryContent) => void;
  /**
   * Store the form as the entry. The kept copy of the unsaved changes is
   * removed once the entry is stored, and not before.
   */
  readonly save: () => Promise<void>;
  /** Give the edit up: remove the kept copy. The entry is not touched. */
  readonly abandon: () => Promise<void>;
  /** Put the saved entry back on the form and remove the kept copy. */
  readonly startAgain: () => Promise<void>;
  /**
   * Read the entry again and put it on the form, replacing what is typed
   * here, and remove the kept copy.
   */
  readonly loadLatest: () => Promise<void>;
}

/**
 * The keeping that was started when the edit screen for an entry was last
 * left, by store and entry ID. The screen can be opened again before that
 * has reached storage; it waits for it, so what was typed is offered and
 * not missed.
 */
const leaving = new WeakMap<RecordStore, Map<string, Promise<void>>>();

function contentOf(entry: JournalEntry): EntryContent {
  return { responses: entry.responses, feelings: entry.feelings ?? [] };
}

/**
 * Hold the edit form for one entry and keep its unsaved changes.
 *
 * What is typed is not the entry until the person saves it. Until then it
 * is kept on this device as a record of its own, encrypted, a moment after
 * typing stops, when the page is hidden or closed, when the screen is left
 * and before the app locks. It never changes the entry, is never sent
 * anywhere, and never calls AI.
 *
 * @param id - The entry's ID.
 * @returns The form.
 */
export function useEditForm(id: string): EditForm {
  const { records, events, lockHooks } = useServices();
  const [found, setFound] = useState<Found>({ kind: "loading" });
  const [content, setContent] = useState<EntryContent>(BLANK);
  const [recovered, setRecovered] = useState<Recovered | undefined>(undefined);
  const [keepState, setKeepState] = useState<SaveState>("idle");
  const [keepError, setKeepError] = useState<unknown>(undefined);
  const entry = useRef<JournalEntry | undefined>(undefined);
  // The version of the entry the changes on the form were made to.
  const basedOn = useRef("");
  // The entry as it was last put on the form or, with unsaved changes
  // brought back, as it was when the person was told what saving replaces:
  // the very object the store gave, which the store compares on saving.
  const seen = useRef<JournalEntry | undefined>(undefined);
  const latest = useRef<EntryContent>(BLANK);
  const autosave = useRef<Autosave<UnfinishedEdit> | undefined>(undefined);
  // True while the entry is being saved or the edit given up: nothing typed
  // then is kept, because the kept copy is about to be removed.
  const closing = useRef(false);
  const mounted = useRef(true);
  // Keeping and removing the copy happen one after the other, in the order
  // they were asked for, so a late "keep" can never land after a "remove".
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inOrder = (work: () => Promise<void>): Promise<void> => {
    const done = queue.current.then(work);
    queue.current = done.catch(() => undefined);
    return done;
  };

  /**
   * Remove the kept copy, after anything already on its way to storage.
   * A copy that cannot be removed is harmless: it is offered again, or
   * removed when it turns out to say what the entry says.
   */
  const drop = async (): Promise<void> => {
    autosave.current?.cancel();
    await autosave.current?.flush();
    await inOrder(() => records.dropUnfinished(id)).catch(() => undefined);
    if (mounted.current) {
      setKeepState("idle");
    }
  };

  /** Keep what is on the form, or remove the copy if nothing is unsaved. */
  const note = (next: EntryContent): void => {
    const saved = entry.current;
    if (saved === undefined || closing.current) {
      return;
    }
    if (sameContent(next, contentOf(saved))) {
      void drop();
    } else {
      autosave.current?.changed({ ...next, basedOn: basedOn.current });
    }
  };

  /** Put an entry on the form, with unsaved changes to it if there are any. */
  const show = (
    saved: JournalEntry | undefined,
    unsaved: UnfinishedEdit | undefined,
  ): void => {
    if (saved?.status !== "complete") {
      entry.current = undefined;
      setFound({ kind: "missing" });
      return;
    }
    entry.current = saved;
    const offered =
      unsaved !== undefined && !sameContent(unsaved, contentOf(saved));
    const shown: EntryContent = offered
      ? { responses: unsaved.responses, feelings: unsaved.feelings }
      : contentOf(saved);
    basedOn.current = offered ? unsaved.basedOn : saved.contentHash;
    seen.current = saved;
    latest.current = shown;
    setFound({ kind: "entry", entry: saved });
    setContent(shown);
    setRecovered(
      offered
        ? { entryChangedSince: unsaved.basedOn !== saved.contentHash }
        : undefined,
    );
    if (unsaved !== undefined && !offered) {
      // It says what the entry says: there is nothing unsaved in it.
      void drop();
    }
  };

  useEffect(() => {
    mounted.current = true;
    closing.current = false;
    const saver = new Autosave<UnfinishedEdit>(
      (edit) =>
        inOrder(async () => {
          try {
            if (!(await records.keepUnfinished(id, edit))) {
              // The entry is not here any more, so nothing was kept.
              throw new Error("no entry to keep an edit for");
            }
          } catch (error) {
            if (mounted.current) {
              setKeepError(error);
            }
            throw error;
          }
        }),
      (state) => {
        if (mounted.current) {
          setKeepState(state);
        }
      },
    );
    autosave.current = saver;

    const load = async (): Promise<void> => {
      await leaving.get(records)?.get(id);
      const saved = await records.get("journal-entry", id);
      // Unsaved changes that cannot be read must not stop the entry from
      // being edited: the form then starts from the entry.
      const unsaved =
        saved?.status === "complete"
          ? await records.unfinished(id).catch(() => undefined)
          : undefined;
      if (mounted.current) {
        show(saved, unsaved);
      }
    };
    void load().catch((error: unknown) => {
      if (mounted.current) {
        setFound({ kind: "failed", message: describeOpenFailure(error) });
      }
    });

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
      mounted.current = false;
      document.removeEventListener("visibilitychange", whenHidden);
      window.removeEventListener("pagehide", whenLeaving);
      unregister();
      // Leaving the screen without saving or cancelling keeps what was
      // typed, to be offered when the entry is next edited.
      const kept = flush();
      const waiting = leaving.get(records) ?? new Map<string, Promise<void>>();
      leaving.set(records, waiting);
      waiting.set(id, kept);
      void kept.then(() => {
        if (waiting.get(id) === kept) {
          waiting.delete(id);
        }
      });
    };
  }, [records, lockHooks, id]);

  return {
    found,
    content,
    recovered,
    keepState,
    keepError,
    change: (next) => {
      setContent(next);
      latest.current = next;
      note(next);
    },
    save: async () => {
      closing.current = true;
      // Nothing is kept from here on, and a copy already on its way to
      // storage is waited for, so the removal below comes after it.
      autosave.current?.cancel();
      await autosave.current?.flush();
      try {
        // Refused if the entry has changed under the form meanwhile, by
        // sync or in another tab: it is never replaced unseen.
        await editEntry(
          { records, events },
          id,
          content,
          seen.current === undefined ? {} : { seen: seen.current },
        );
      } catch (error) {
        // The entry was not stored, so what is on the form is unsaved
        // again and is kept as before.
        closing.current = false;
        note(latest.current);
        throw error;
      }
      await drop();
    },
    abandon: async () => {
      closing.current = true;
      await drop();
    },
    startAgain: async () => {
      const saved = entry.current;
      if (saved === undefined) {
        return;
      }
      show(saved, undefined);
      await drop();
    },
    loadLatest: async () => {
      show(await records.reload("journal-entry", id), undefined);
      await drop();
    },
  };
}
