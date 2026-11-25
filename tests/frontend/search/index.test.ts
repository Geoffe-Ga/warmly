import { describe, expect, it } from "vitest";

import { SearchIndex } from "../../../src/domain/search";

function indexOf(documents: Record<string, string[]>): SearchIndex {
  const index = new SearchIndex();
  for (const [id, fields] of Object.entries(documents)) {
    index.add({ id, fields });
  }
  return index;
}

const ids = (index: SearchIndex, query: string): string[] =>
  index.search(query).map((hit) => hit.id);

describe("the local search index (JR-010)", () => {
  const index = indexOf({
    e1: ["We cooked DINNER together", "Planning weekends", "A note"],
    e2: ["A long walk by the canal", "Dinners out", "Café ☕ at 7"],
    e3: ["Nothing comes to mind this week", "x", "y"],
  });

  it("matches case-insensitively", () => {
    expect(ids(index, "dinner")).toEqual(["e1", "e2"]);
    expect(ids(index, "DINNER")).toEqual(["e1", "e2"]);
    expect(index.search("dinner")).toEqual([
      expect.objectContaining({ id: "e1" }),
      expect.objectContaining({ id: "e2" }),
    ]);
  });

  it.each([
    ["every word must match", "cooked weekends", ["e1"]],
    ["words may be in different answers and any order", "note cooked", ["e1"]],
    ["a word that is nowhere matches nothing", "cooked canal", []],
    ["the last word may be unfinished", "wal", ["e2"]],
    ["earlier words must be whole", "wal canal", []],
    ["earlier words whole, last unfinished", "walk can", ["e2"]],
    ["a whole word also matches as the last word", "walk", ["e2"]],
    ["a word is not found inside another", "inner", []],
    ["numbers are words", "7", ["e2"]],
    ["accents written either way match", "café", ["e2"]],
    ["an accent is not ignored", "cafe", []],
    ["punctuation in the query is ignored", "dinner!!", ["e1", "e2"]],
    ["an emoji in the query is ignored", "☕ café", ["e2"]],
    ["a repeated word is fine", "walk walk", ["e2"]],
  ])("%s: %j", (_rule, query, expected) => {
    expect(ids(index, query)).toEqual(expected);
  });

  it.each(["", "   ", "?!", "💛"])(
    "finds nothing for %j: there is no word to look for",
    (query) => {
      expect(index.search(query)).toEqual([]);
    },
  );

  it("finds nothing in an empty index", () => {
    expect(new SearchIndex().search("dinner")).toEqual([]);
    expect(new SearchIndex().size).toBe(0);
  });

  it("returns hits in the order the documents were added", () => {
    expect(ids(indexOf({ b: ["tea"], a: ["tea"], c: ["tea"] }), "tea")).toEqual(
      ["b", "a", "c"],
    );
  });

  it("replaces a document added again under the same ID", () => {
    const changing = indexOf({ e1: ["old wording"] });

    changing.add({ id: "e1", fields: ["new wording"] });

    expect(changing.size).toBe(1);
    expect(ids(changing, "old")).toEqual([]);
    expect(ids(changing, "new")).toEqual(["e1"]);
  });

  it("forgets a removed document, and everything when cleared", () => {
    const changing = indexOf({ e1: ["tea"], e2: ["tea"] });

    changing.remove("e1");
    changing.remove("never-there");
    expect(ids(changing, "tea")).toEqual(["e2"]);

    changing.clear();
    expect(changing.size).toBe(0);
    expect(ids(changing, "tea")).toEqual([]);
  });
});

describe("a search snippet (JR-010)", () => {
  it("is the whole text when it is short", () => {
    expect(
      indexOf({ e1: ["We cooked DINNER together"] }).search("dinner"),
    ).toEqual([{ id: "e1", snippet: "We cooked DINNER together" }]);
  });

  it("comes from the first answer that has a match, as written", () => {
    const index = indexOf({
      e1: ["Nothing here", "Planning the WEEKENDS earlier", "weekends again"],
    });

    expect(index.search("weekends")[0]?.snippet).toBe(
      "Planning the WEEKENDS earlier",
    );
  });

  it("is cut around the match on word boundaries, with marks where text was left out", () => {
    const before = "alpha ".repeat(20);
    const after = " omega".repeat(30);
    const index = indexOf({ e1: [`${before}needle${after}`] });

    const snippet = index.search("needle")[0]?.snippet ?? "";

    expect(snippet.startsWith("…alpha")).toBe(true);
    expect(snippet.endsWith("omega…")).toBe(true);
    expect(snippet).toContain(" needle ");
    expect(snippet.length).toBeLessThan(140);
    expect(snippet).toMatch(/^…(alpha )+needle( omega)+…$/);
  });

  it("has no leading mark when the match is near the start, and no trailing one near the end", () => {
    const long = " filler".repeat(40);

    expect(
      indexOf({ e1: [`needle${long}`] }).search("needle")[0]?.snippet,
    ).toMatch(/^needle( filler)+…$/);
    expect(
      indexOf({ e1: [`${long.trim()} needle`] }).search("needle")[0]?.snippet,
    ).toMatch(/^…(filler )+needle$/);
  });

  it("puts line breaks and runs of spaces on one line", () => {
    expect(
      indexOf({ e1: ["one\n\ntwo   needle\tthree"] }).search("needle")[0]
        ?.snippet,
    ).toBe("one two needle three");
  });

  it("shows the word that matched the unfinished last word", () => {
    expect(
      indexOf({ e1: ["a walk and a waltz"] }).search("wal")[0]?.snippet,
    ).toBe("a walk and a waltz");
  });

  it("copes with one very long unbroken word", () => {
    const snippet =
      indexOf({ e1: [`${"x".repeat(300)} needle ${"y".repeat(300)}`] }).search(
        "needle",
      )[0]?.snippet ?? "";

    expect(snippet).toContain("needle");
    expect(snippet.length).toBeLessThan(140);
  });
});

describe("search speed (JR-010)", () => {
  const WORDS = [
    "walk",
    "dinner",
    "canal",
    "weekend",
    "note",
    "tea",
    "plan",
    "listen",
    "garden",
    "morning",
    "quiet",
    "laugh",
    "call",
    "music",
    "rain",
    "letter",
    "kitchen",
    "window",
    "train",
    "story",
    "bread",
    "river",
    "candle",
    "book",
  ];

  function sentence(seed: number, length: number): string {
    return Array.from(
      { length },
      (_, i) => WORDS[(seed * 7 + i * 13) % WORDS.length] ?? "",
    ).join(" ");
  }

  it("indexes 2,000 entries in under 500 ms and answers a query in under 50 ms", () => {
    const documents = Array.from({ length: 2_000 }, (_, n) => ({
      id: `entry-${String(n)}`,
      fields: [
        `${sentence(n, 60)} unique${String(n)}`,
        sentence(n + 1, 60),
        sentence(n + 2, 60),
      ],
    }));
    const index = new SearchIndex();

    const startedIndexing = performance.now();
    for (const document of documents) {
      index.add(document);
    }
    const indexing = performance.now() - startedIndexing;

    const startedQuery = performance.now();
    const common = index.search("walk din");
    const rare = index.search("unique1999");
    const none = index.search("walk zzzz");
    const querying = (performance.now() - startedQuery) / 3;

    expect(index.size).toBe(2_000);
    expect(common.length).toBe(2_000);
    expect(rare.map((hit) => hit.id)).toEqual(["entry-1999"]);
    expect(none).toEqual([]);
    expect(indexing).toBeLessThan(500);
    expect(querying).toBeLessThan(50);
  });
});
