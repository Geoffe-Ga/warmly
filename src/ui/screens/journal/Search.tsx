import type { JSX } from "preact";
import { useMemo } from "preact/hooks";

import { SearchIndex } from "../../../domain/search";
import { parseQuery } from "../../../domain/search/tokenize";
import { PROMPTS, type JournalEntry } from "../../../domain/journal/types";

/** One entry that matched, with a piece of its text around the match. */
export interface JournalMatch {
  readonly entry: JournalEntry;
  readonly snippet: string;
}

/** The outcome of looking for what was typed in the search box. */
export interface JournalSearch {
  /**
   * Whether there is anything to look for. A box that is empty, or holds
   * only spaces, punctuation or emoji, has no words to search with.
   */
  readonly searching: boolean;
  /** The matching entries, in the order the entries were given. */
  readonly matches: readonly JournalMatch[];
}

/**
 * Search completed journal entries for what was typed (PRD JR-010).
 *
 * The index is built in memory from the entries passed in, and built again
 * whenever they change. It is held only by the screen that is showing, so
 * it is gone as soon as the app locks. Nothing is stored and nothing is
 * sent anywhere; searching never calls AI.
 *
 * @param entries - The entries to search, in the order to show them.
 * @param query - What is typed in the search box.
 * @returns Whether a search is under way, and what it found.
 */
export function useJournalSearch(
  entries: readonly JournalEntry[],
  query: string,
): JournalSearch {
  const index = useMemo(() => {
    const built = new SearchIndex();
    for (const entry of entries) {
      built.add({
        id: entry.id,
        fields: PROMPTS.map((prompt) => entry.responses[prompt.key]),
      });
    }
    return built;
  }, [entries]);

  return useMemo(() => {
    if (parseQuery(query).prefix === undefined) {
      return { searching: false, matches: [] };
    }
    const snippets = new Map(
      index.search(query).map((hit) => [hit.id, hit.snippet]),
    );
    return {
      searching: true,
      matches: entries.flatMap((entry) => {
        const snippet = snippets.get(entry.id);
        return snippet === undefined ? [] : [{ entry, snippet }];
      }),
    };
  }, [index, entries, query]);
}

/**
 * How many entries a search found, announced to screen readers when it
 * changes. It stays in the page, empty, while nothing is being searched
 * for, so the announcement is made from a region that already exists.
 *
 * @param props - The search.
 * @returns The count.
 */
export function ResultCount(props: {
  readonly search: JournalSearch;
}): JSX.Element {
  const { searching, matches } = props.search;
  let text = "";
  if (searching) {
    text =
      matches.length === 0
        ? "No entry mentions that."
        : `${String(matches.length)} ${matches.length === 1 ? "entry" : "entries"} found.`;
  }
  return (
    <p role="status" aria-live="polite" class="result-count">
      {text}
    </p>
  );
}
