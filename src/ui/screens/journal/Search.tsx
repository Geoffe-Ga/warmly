import type { JSX } from "preact";
import { useMemo } from "preact/hooks";

import { SearchIndex, parseQuery } from "../../../domain/search";

/** Something in the timeline that can be searched. */
export interface Searchable {
  readonly id: string;
  /** Its pieces of text, in the order they should be quoted. */
  readonly fields: readonly string[];
}

/** One item that matched, with a piece of its text around the match. */
export interface JournalMatch<T extends Searchable> {
  readonly item: T;
  readonly snippet: string;
}

/** The outcome of looking for what was typed in the search box. */
export interface JournalSearch<T extends Searchable = Searchable> {
  /**
   * Whether there is anything to look for. A box that is empty, or holds
   * only spaces, punctuation or emoji, has no words to search with.
   */
  readonly searching: boolean;
  /** What matched, in the order the items were given. */
  readonly matches: readonly JournalMatch<T>[];
}

/**
 * Search the timeline for what was typed (PRD JR-010, PC-001).
 *
 * The index is built in memory from the items passed in, and built again
 * whenever they change. It is held only by the screen that is showing, so
 * it is gone as soon as the app locks. Nothing is stored and nothing is
 * sent anywhere; searching never calls AI.
 *
 * @param items - What to search, in the order to show it.
 * @param query - What is typed in the search box.
 * @returns Whether a search is under way, and what it found.
 */
export function useJournalSearch<T extends Searchable>(
  items: readonly T[],
  query: string,
): JournalSearch<T> {
  const index = useMemo(() => {
    const built = new SearchIndex();
    for (const item of items) {
      built.add({ id: item.id, fields: item.fields });
    }
    return built;
  }, [items]);

  return useMemo(() => {
    if (parseQuery(query).prefix === undefined) {
      return { searching: false, matches: [] };
    }
    const snippets = new Map(
      index.search(query).map((hit) => [hit.id, hit.snippet]),
    );
    return {
      searching: true,
      matches: items.flatMap((item) => {
        const snippet = snippets.get(item.id);
        return snippet === undefined ? [] : [{ item, snippet }];
      }),
    };
  }, [index, items, query]);
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
