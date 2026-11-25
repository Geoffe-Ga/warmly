import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { currentDraft } from "../../../domain/journal/drafts";
import type { JournalEntry } from "../../../domain/journal/types";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ResultCount, useJournalSearch } from "./Search";
import { formatEntryDate, useJournalEntries, type Journal } from "./shared";

function EntryLink(props: {
  readonly entry: JournalEntry;
  /** A piece of the entry's text to show under its date, for a search. */
  readonly snippet?: string;
}): JSX.Element {
  const { entry } = props;
  return (
    <li>
      <Link href={pathFor("journal-entry", { id: entry.id })} class="action">
        {formatEntryDate(entry.entryDate)}
        {props.snippet !== undefined && props.snippet !== "" && (
          <span class="action__detail">{props.snippet}</span>
        )}
      </Link>
    </li>
  );
}

/** What to say when there is no finished entry at all. */
function emptyMessage(hasDraft: boolean): string {
  return hasDraft
    ? "You haven't finished an entry yet."
    : "You haven't written anything yet.";
}

/** The draft being written, kept apart from the completed entries. */
function DraftLink(props: { readonly draft: JournalEntry }): JSX.Element {
  return (
    <nav aria-label="Draft">
      <ul class="action-list">
        <li>
          <Link href={pathFor("journal-new")} class="action">
            Carry on with your draft from{" "}
            {formatEntryDate(props.draft.entryDate)}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/** Searched while the entries are still loading: nothing. */
const NO_ENTRIES: readonly JournalEntry[] = [];

/**
 * The finished journal entries, newest first, with a box to search them.
 * Used by the journal and by Reflect, so the two never differ. Search
 * matches whole words, ignoring case, with the last word allowed to be
 * unfinished (JR-010). Nothing here calls AI, and what is typed in the
 * search box stays in memory: it is never put in the address, in storage
 * or in a log.
 *
 * @param props - The journal as loaded, and whether a draft exists (it
 *   changes what is said when there are no finished entries).
 * @returns The search box, any notices, and the list.
 */
export function JournalBrowser(props: {
  readonly journal: Journal;
  readonly hasDraft: boolean;
}): JSX.Element {
  const { journal } = props;
  const [query, setQuery] = useState("");
  const all = journal.state === "ready" ? journal.entries : undefined;
  const entries = useMemo(
    () => all?.filter((entry) => entry.status === "complete"),
    [all],
  );
  const search = useJournalSearch(entries ?? NO_ENTRIES, query);
  const shown = search.searching
    ? search.matches
    : entries?.map((entry) => ({ entry, snippet: "" }));
  const unreadable = journal.state === "ready" ? journal.unreadable : 0;

  return (
    <>
      <TextField
        label="Search your journal"
        name="journal-search"
        autocomplete="off"
        hint="Finds entries that have every word you type. It looks through what you wrote on this device only."
        value={query}
        onInput={setQuery}
      />
      {journal.state === "loading" && (
        <StatusBanner tone="info" label="Loading">
          Getting your entries.
        </StatusBanner>
      )}
      {journal.state === "failed" && (
        <StatusBanner tone="error" label="Couldn't open your journal">
          {journal.message}
        </StatusBanner>
      )}
      {unreadable > 0 && (
        <StatusBanner tone="warning" label="Some entries can't be shown">
          {unreadable === 1
            ? "1 entry saved on this device can't be read by this version of Warmly. It has been left as it is."
            : `${String(unreadable)} entries saved on this device can't be read by this version of Warmly. They have been left as they are.`}
        </StatusBanner>
      )}
      <ResultCount search={search} />
      {entries?.length === 0 && <p>{emptyMessage(props.hasDraft)}</p>}
      {shown !== undefined && shown.length > 0 && (
        <nav aria-label="Entries">
          <ul class="action-list">
            {shown.map(({ entry, snippet }) => (
              <EntryLink key={entry.id} entry={entry} snippet={snippet} />
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}

/**
 * The journal: completed entries newest first, a box to search them, the
 * draft being written if there is one, and the way to a new entry (PRD
 * JR-001, JR-004). A draft is not a completed entry, so it is shown apart
 * and is not searched. Nothing here calls AI.
 *
 * @returns The journal timeline screen.
 */
export function Timeline(): JSX.Element {
  const journal = useJournalEntries();
  const draft = currentDraft(journal.state === "ready" ? journal.entries : []);

  return (
    <PageLayout title="Journal" lead="Your entries, newest first.">
      {draft === undefined ? (
        <p>
          <Link href={pathFor("journal-new")}>Write a new entry</Link>
        </p>
      ) : (
        <DraftLink draft={draft} />
      )}
      <JournalBrowser journal={journal} hasDraft={draft !== undefined} />
    </PageLayout>
  );
}
