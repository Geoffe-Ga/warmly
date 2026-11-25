/**
 * The local search index (PRD JR-010, SEC-007; D-12).
 *
 * The index lives in memory only. It is built from decrypted records after
 * the app is unlocked and thrown away with them when it locks. It is never
 * written to storage, and a query is never put in a URL, in storage or in a
 * log. Searching makes no network request and never calls AI.
 *
 * The index knows nothing about journal entries: anything with an ID and
 * some text can be added, so other kinds of record can join later.
 */
import { parseQuery, tokenize, type Query, type Token } from "./tokenize";

/** Something that can be searched. */
export interface SearchDocument {
  /** Identifies the document; adding the same ID again replaces it. */
  readonly id: string;
  /** The pieces of text to search, in the order they should be quoted. */
  readonly fields: readonly string[];
}

/** One document that matched a query. */
export interface SearchHit {
  readonly id: string;
  /** A short piece of the document's text around the first match. */
  readonly snippet: string;
}

/** How much text a snippet shows before and after the matching word. */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

interface IndexedField {
  readonly text: string;
  readonly tokens: readonly Token[];
}

interface Indexed {
  readonly fields: readonly IndexedField[];
  /** Every distinct word in the document. */
  readonly words: ReadonlySet<string>;
}

function matches(document: Indexed, query: Query): boolean {
  if (!query.whole.every((word) => document.words.has(word))) {
    return false;
  }
  const { prefix } = query;
  if (prefix === undefined || document.words.has(prefix)) {
    return true;
  }
  for (const word of document.words) {
    if (word.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/** Whether a word is one the query asked for. */
function wanted(word: string, query: Query): boolean {
  return (
    query.whole.includes(word) ||
    (query.prefix !== undefined && word.startsWith(query.prefix))
  );
}

/** Cut a piece of text around a word, on word boundaries where it can. */
function excerpt(text: string, token: Token): string {
  let start = Math.max(0, token.start - SNIPPET_BEFORE);
  let end = Math.min(text.length, token.end + SNIPPET_AFTER);
  // Move in to the nearest space, so the snippet does not start or end in
  // the middle of a word.
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space !== -1 && space < token.start ? space + 1 : start;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    end = space > token.end ? space : end;
  }
  const middle = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${middle}${end < text.length ? "…" : ""}`;
}

function snippetFor(document: Indexed, query: Query): string {
  for (const field of document.fields) {
    const token = field.tokens.find((each) => wanted(each.word, query));
    if (token !== undefined) {
      return excerpt(field.text, token);
    }
  }
  return "";
}

/** An in-memory index of searchable documents. */
export class SearchIndex {
  readonly #documents = new Map<string, Indexed>();

  /** How many documents are indexed. */
  get size(): number {
    return this.#documents.size;
  }

  /**
   * Add a document, or replace the one with the same ID.
   *
   * @param document - The document.
   */
  add(document: SearchDocument): void {
    const fields = document.fields.map((text) => ({
      text,
      tokens: tokenize(text),
    }));
    this.#documents.set(document.id, {
      fields,
      words: new Set(
        fields.flatMap((field) => field.tokens.map((token) => token.word)),
      ),
    });
  }

  /**
   * Remove a document. Removing one that is not there does nothing.
   *
   * @param id - The document's ID.
   */
  remove(id: string): void {
    this.#documents.delete(id);
  }

  /** Forget every document. */
  clear(): void {
    this.#documents.clear();
  }

  /**
   * Find the documents that have every word of a query.
   *
   * @param text - The query as typed. The last word matches any word that
   *   starts with it; the others must appear in full.
   * @returns The matching documents, in the order they were added, each
   *   with a snippet. A query with no words matches nothing: there is
   *   nothing to look for.
   */
  search(text: string): SearchHit[] {
    const query = parseQuery(text);
    if (query.prefix === undefined) {
      return [];
    }
    const hits: SearchHit[] = [];
    for (const [id, document] of this.#documents) {
      if (matches(document, query)) {
        hits.push({ id, snippet: snippetFor(document, query) });
      }
    }
    return hits;
  }
}
