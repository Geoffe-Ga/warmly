import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { PROMPTS, type JournalEntry } from "../../../domain/journal/types";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { NOT_SAVED_YET, formatEntryDate, useJournalEntries } from "./shared";

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
  const date = formatEntryDate(entry.entryDate);
  return (
    <li>
      <Link href={pathFor("journal-entry", { id: entry.id })} class="action">
        {entry.status === "draft" ? `${date} (draft)` : date}
      </Link>
    </li>
  );
}

/**
 * The journal: entries newest first, a box to search them, and the way to a
 * new entry (PRD JR-001). Nothing here calls AI, and what is typed in the
 * search box stays in memory: it is never put in the address.
 *
 * @returns The journal timeline screen.
 */
export function Timeline(): JSX.Element {
  const entries = useJournalEntries();
  const [query, setQuery] = useState("");
  const shown = entries?.filter((entry) => mentions(entry, query));

  return (
    <PageLayout title="Journal" lead="Your entries, newest first.">
      <p>
        <Link href={pathFor("journal-new")}>Write a new entry</Link>
      </p>
      <StatusBanner tone="warning" label="Not saved yet">
        {NOT_SAVED_YET}
      </StatusBanner>
      <TextField
        label="Search your journal"
        name="journal-search"
        autocomplete="off"
        hint="Looks through what you wrote, on this device only."
        value={query}
        onInput={setQuery}
      />
      {shown === undefined && (
        <StatusBanner tone="info" label="Loading">
          Getting your entries.
        </StatusBanner>
      )}
      {shown !== undefined && shown.length === 0 && (
        <p>
          {entries?.length === 0
            ? "You haven't written anything yet."
            : "No entry mentions that."}
        </p>
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
