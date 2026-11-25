import { describe, expect, it } from "vitest";

import {
  fold,
  parseQuery,
  tokenize,
} from "../../../src/domain/search/tokenize";

const words = (text: string): string[] =>
  tokenize(text).map((token) => token.word);

describe("splitting text into words (JR-010)", () => {
  it.each([
    ["lower-cases", "We Cooked DINNER", ["we", "cooked", "dinner"]],
    ["drops punctuation", "Well... yes, really!", ["well", "yes", "really"]],
    [
      "splits on hyphens and apostrophes",
      "well-known, isn't",
      ["well", "known", "isn", "t"],
    ],
    [
      "keeps numbers",
      "at 7 on 2026-11-25",
      ["at", "7", "on", "2026", "11", "25"],
    ],
    ["keeps accents", "Café naïve", ["café", "naïve"]],
    ["composes accents written as separate marks", "Café", ["café"]],
    ["folds full-width letters", "ＤＩＮＮＥＲ", ["dinner"]],
    ["opens ligatures", "ﬁnally", ["finally"]],
    ["splits what normalising splits", "½ cup", ["1", "2", "cup"]],
    ["treats emoji as separators", "happy💛day ☕", ["happy", "day"]],
    [
      "keeps other scripts",
      "ありがとう 谢谢 спасибо",
      ["ありがとう", "谢谢", "спасибо"],
    ],
    [
      "splits on line breaks and tabs",
      "one\ntwo\tthree",
      ["one", "two", "three"],
    ],
    ["finds nothing in an empty text", "", []],
    ["finds nothing in spaces", "  \n ", []],
    ["finds nothing in punctuation and emoji alone", "?!… 💛", []],
  ])("%s: %j", (_rule, text, expected) => {
    expect(words(text)).toEqual(expected);
  });

  it("says where each word is in the original text", () => {
    const text = "We  cooked: DINNER!";

    expect(tokenize(text)).toEqual([
      { word: "we", start: 0, end: 2 },
      { word: "cooked", start: 4, end: 10 },
      { word: "dinner", start: 12, end: 18 },
    ]);
    for (const token of tokenize(text)) {
      expect(fold(text.slice(token.start, token.end))).toBe(token.word);
    }
  });

  it("gives every part of a word that normalising split the place of the whole", () => {
    expect(tokenize("a ½")).toEqual([
      { word: "a", start: 0, end: 1 },
      { word: "1", start: 2, end: 3 },
      { word: "2", start: 2, end: 3 },
    ]);
  });

  it("does not strip accents: 'cafe' and 'café' are different words", () => {
    expect(fold("CAFE")).toBe("cafe");
    expect(fold("CAFÉ")).toBe("café");
    expect(fold("cafe")).not.toBe(fold("café"));
  });
});

describe("reading a query (JR-010)", () => {
  it.each([
    ["one word is a prefix", "din", [], "din"],
    [
      "the last word is the prefix, the rest are whole",
      "Cooked DIN",
      ["cooked"],
      "din",
    ],
    [
      "a trailing space does not finish the last word",
      "cooked dinner ",
      ["cooked"],
      "dinner",
    ],
    ["punctuation is ignored", "cooked, dinner!", ["cooked"], "dinner"],
    ["an empty query has no words", "", [], undefined],
    ["spaces have no words", "   ", [], undefined],
    ["emoji and punctuation have no words", "💛 ?!", [], undefined],
  ])("%s: %j", (_rule, text, whole, prefix) => {
    expect(parseQuery(text)).toEqual({ whole, prefix });
  });
});
