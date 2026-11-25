import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { currentDraft } from "../../../domain/journal/drafts";
import { PROMPTS, type JournalEntry } from "../../../domain/journal/types";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { CANNOT_OPEN, formatEntryDate, useJournalEntries } from "./shared";

/**
 * Whether an entry mentions the text, ignoring case. A plain stand-in until
 * real local search is built: it looks for the text exactly as typed.
 */
function mentions(entry: JournalEntry, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return (
    wanted === "" ||
    PROMPTS.some((prompt) =>
      entry.responses[prompt.key].toLowerCase().includes(wanted),
    )
  );
}

function EntryLink(props: { readonly entry: JournalEntry }): JSX.Element {
  const { entry } = props;
  return (
    <li>
      <Link href={pathFor("journal-entry", { id: entry.id })} class="action">
        {formatEntryDate(entry.entryDate)}
      </Link>
    </li>
  );
}

/** What to say when no entry is listed. */
function emptyMessage(noEntries: boolean, hasDraft: boolean): string {
  if (!noEntries) {
    return "No entry mentions that.";
  }
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

/**
 * The journal: completed entries newest first, a box to search them, the
 * draft being written if there is one, and the way to a new entry (PRD
 * JR-001, JR-004). A draft is not a completed entry, so it is shown apart
 * and is not searched. Nothing here calls AI, and what is typed in the
 * search box stays in memory: it is never put in the address.
 *
 * @returns The journal timeline screen.
 */
export function Timeline(): JSX.Element {
  const journal = useJournalEntries();
  const [query, setQuery] = useState("");
  const all = journal.state === "ready" ? journal.entries : undefined;
  const entries = all?.filter((entry) => entry.status === "complete");
  const draft = currentDraft(all ?? []);
  const shown = entries?.filter((entry) => mentions(entry, query));
  const unreadable = journal.state === "ready" ? journal.unreadable : 0;

  return (
    <PageLayout title="Journal" lead="Your entries, newest first.">
      {draft === undefined ? (
        <p>
          <Link href={pathFor("journal-new")}>Write a new entry</Link>
        </p>
      ) : (
        <DraftLink draft={draft} />
      )}
      <TextField
        label="Search your journal"
        name="journal-search"
        autocomplete="off"
        hint="Looks through what you wrote, on this device only."
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
          {CANNOT_OPEN}
        </StatusBanner>
      )}
      {unreadable > 0 && (
        <StatusBanner tone="warning" label="Some entries can't be shown">
          {unreadable === 1
            ? "1 entry saved on this device can't be read by this version of Warmly. It has been left as it is."
            : `${String(unreadable)} entries saved on this device can't be read by this version of Warmly. They have been left as they are.`}
        </StatusBanner>
      )}
      {shown !== undefined && shown.length === 0 && (
        <p>{emptyMessage(entries?.length === 0, draft !== undefined)}</p>
      )}
      {shown !== undefined && shown.length > 0 && (
        <nav aria-label="Entries">
          <ul class="action-list">
            {shown.map((entry) => (
              <EntryLink key={entry.id} entry={entry} />
            ))}
          </ul>
        </nav>
      )}
    </PageLayout>
  );
}
