import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { currentDraft } from "../../../domain/journal/drafts";
import {
  PROMPTS,
  type EntryDate,
  type JournalEntry,
} from "../../../domain/journal/types";
import {
  AFTER_LABEL,
  AFTER_PROMPTS,
  type PostConversationReflection,
} from "../../../domain/post-conversation/types";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { NEW_AFTER } from "./AfterConversation";
import { ResultCount, useJournalSearch } from "./Search";
import {
  formatEntryDate,
  useAfterReflections,
  useJournalEntries,
  type Journal,
} from "./shared";

/** One thing in the timeline: a journal entry, or a later reflection. */
interface TimelineItem {
  readonly id: string;
  readonly href: string;
  readonly date: EntryDate;
  readonly createdAt: string;
  /** Said before the date when it is not a journal entry. */
  readonly label?: string;
  readonly fields: readonly string[];
}

function entryItem(entry: JournalEntry): TimelineItem {
  return {
    id: entry.id,
    href: pathFor("journal-entry", { id: entry.id }),
    date: entry.entryDate,
    createdAt: entry.createdAt,
    fields: PROMPTS.map((prompt) => entry.responses[prompt.key]),
  };
}

function afterItem(after: PostConversationReflection): TimelineItem {
  return {
    id: after.id,
    href: pathFor("after-conversation", { id: after.id }),
    date: after.entryDate,
    createdAt: after.createdAt,
    // It is never shown as a journal entry (PRD PC-003).
    label: AFTER_LABEL,
    fields: AFTER_PROMPTS.map((prompt) => after.responses[prompt.key]),
  };
}

/** Newest first, by day, then by when it was written, then by ID. */
function newestFirst(items: readonly TimelineItem[]): TimelineItem[] {
  return [...items].sort(
    (left, right) =>
      right.date.date.localeCompare(left.date.date) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function ItemLink(props: {
  readonly item: TimelineItem;
  /** A piece of the item's text to show under its date, for a search. */
  readonly snippet?: string;
}): JSX.Element {
  const { item } = props;
  return (
    <li>
      <Link href={item.href} class="action">
        {item.label !== undefined && `${item.label}: `}
        {formatEntryDate(item.date)}
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
          <Link href={pathFor("journal-new")} class="button button--primary">
            Carry on with your draft from{" "}
            {formatEntryDate(props.draft.entryDate)}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

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
  const after = useAfterReflections();
  const items = useMemo(
    () =>
      newestFirst([
        ...(entries ?? []).map(entryItem),
        ...(entries === undefined ? [] : after.map(afterItem)),
      ]),
    [entries, after],
  );
  const search = useJournalSearch(items, query);
  const shown = search.searching
    ? search.matches
    : items.map((item) => ({ item, snippet: "" }));
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
      {shown.length > 0 && (
        <nav aria-label="Entries">
          <ul class="action-list">
            {shown.map(({ item, snippet }) => (
              <ItemLink key={item.id} item={item} snippet={snippet} />
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
      <div class="button-row">
        {draft === undefined ? (
          <Link href={pathFor("journal-new")} class="button button--primary">
            Write a new entry
          </Link>
        ) : (
          <DraftLink draft={draft} />
        )}
        {/* Opened only by choosing to: nothing leads here by itself. */}
        <Link
          href={pathFor("after-conversation", { id: NEW_AFTER })}
          class="button button--secondary"
        >
          Write about a conversation you had
        </Link>
      </div>
      <JournalBrowser journal={journal} hasDraft={draft !== undefined} />
    </PageLayout>
  );
}
