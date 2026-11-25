/**
 * Turning text into the words that local search matches on (PRD JR-010).
 *
 * The rules are deliberately plain: no stemming, no spelling correction and
 * no guessing at meaning. A word is a run of letters and numbers. Words are
 * compared after Unicode NFKC normalisation and lower-casing, so "Café",
 * "CAFÉ" and "cafe" followed by a combining accent are the same word, and
 * full-width or ligature forms match their ordinary spelling. Accents are
 * kept: "cafe" and "café" are different words.
 *
 * A known limit: writing that puts no spaces between words, such as Chinese
 * and Japanese, comes out as one long "word" per phrase. Such text can be
 * found by how a phrase begins, not by a word inside it. Splitting it into
 * words needs a dictionary, which the MVP leaves out.
 */

/** A run of letters, numbers and the marks that combine with them. */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/** A word made only of ASCII letters and digits. */
const PLAIN = /^[0-9A-Za-z]+$/;

/** One word of a text, and where it is in that text. */
export interface Token {
  /** The word in its comparable form. */
  readonly word: string;
  /** Where the word starts in the original text. */
  readonly start: number;
  /** Where it ends (exclusive). */
  readonly end: number;
}

/**
 * Put a word in its comparable form.
 *
 * @param text - A word as written.
 * @returns The NFKC-normalised, lower-cased form.
 */
export function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * Split text into its words.
 *
 * @param text - Any text, as written.
 * @returns The words in order, each with its place in the original text.
 *   Punctuation, spaces, symbols and emoji separate words and are dropped.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const written = match[0];
    const start = match.index;
    const end = start + written.length;
    if (PLAIN.test(written)) {
      // Most words: unaccented Latin letters and digits, which normalising
      // leaves alone. Skipping it keeps indexing a long journal quick.
      tokens.push({ word: written.toLowerCase(), start, end });
      continue;
    }
    // Normalising can turn one written word into several: "½" becomes
    // "1⁄2". Each part keeps the place of the word it came from.
    for (const part of fold(written).matchAll(WORD)) {
      tokens.push({ word: part[0], start, end });
    }
  }
  return tokens;
}

/** A search query, ready to match. */
export interface Query {
  /** Words that must each appear in full. */
  readonly whole: readonly string[];
  /**
   * The last word typed, which may still be unfinished: it matches any word
   * that starts with it. `undefined` when the query has no words.
   */
  readonly prefix: string | undefined;
}

/**
 * Read what was typed into the search box.
 *
 * @param text - The query as typed.
 * @returns The words to match. Every word must match (AND). A query with no
 *   letters or numbers has no words, so there is nothing to search for.
 */
export function parseQuery(text: string): Query {
  const words = tokenize(text).map((token) => token.word);
  return { whole: words.slice(0, -1), prefix: words.at(-1) };
}
