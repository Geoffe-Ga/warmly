/**
 * AI answers are checked against a schema and against what was actually
 * sent (PRD AI-007 to AI-012, SEC-010; AC-07, AC-10, AC-26; ADR-0008).
 */
import { h, render } from "preact";
import { describe, expect, it } from "vitest";

import {
  LIMITS,
  MalformedResponseError,
  parseReflection,
} from "../../../src/ai/contracts";
import {
  UngroundedCitationError,
  groundAlternatives,
  groundCards,
  groundReflection,
} from "../../../src/ai/grounding";
import {
  DuplicateSourceError,
  buildManifest,
  lookup,
  promptFor,
} from "../../../src/ai/manifest";
import type { ResponseKey, SourceEntry } from "../../../src/ai/provider";

import fixture from "./fixtures/adversarial-v1.json";

const ENTRIES: readonly SourceEntry[] = fixture.entries;
const [E1, E2] = ENTRIES as [SourceEntry, SourceEntry];
const MANIFEST = buildManifest(ENTRIES);

function ground(kind: string, response: unknown): unknown {
  if (kind === "reflect") {
    return groundReflection(response, MANIFEST);
  }
  return kind === "cards"
    ? groundCards(response, MANIFEST)
    : groundAlternatives(response);
}

function failure(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const QUOTE = "cooked dinner together";

function evidence(alias = "E1", key: ResponseKey = "good", quote = QUOTE) {
  return { alias, key, quote };
}

function segment(over: Record<string, unknown> = {}) {
  return {
    category: "appreciation",
    text: "I loved cooking with you on Sunday.",
    evidenceKind: "paraphrase",
    teachingExplanation: "Names one specific moment.",
    evidence: [evidence()],
    ...over,
  };
}

function card(segments: unknown[] = [segment()]) {
  return { type: "appreciation", theme: "Time together", segments };
}

describe("the source manifest (AI-012, D-16)", () => {
  it("names each entry for this request only, in order", () => {
    expect(MANIFEST.sources.map((source) => source.alias)).toEqual([
      "E1",
      "E2",
    ]);
    expect(lookup(MANIFEST, "E2")).toMatchObject({
      entryId: E2.id,
      sourceHash: E2.contentHash,
      responses: E2.responses,
    });
    expect(lookup(MANIFEST, "E3")).toBeUndefined();
    expect(lookup(MANIFEST, "e1")).toBeUndefined();
  });

  it("refuses the same entry twice, so one name means one entry", () => {
    expect(() => buildManifest([E1, E2, E1])).toThrow(DuplicateSourceError);
  });

  it("cannot be changed after it is built", () => {
    expect(Object.isFrozen(MANIFEST)).toBe(true);
    expect(Object.isFrozen(MANIFEST.sources)).toBe(true);
    expect(Object.isFrozen(MANIFEST.sources[0])).toBe(true);
    expect(Object.isFrozen(MANIFEST.sources[0]?.responses)).toBe(true);
  });

  it("keeps the text as it was when sent, even if the entry object changes later", () => {
    const entry = {
      id: "00000000-0000-4000-8000-0000000000aa",
      contentHash: "a".repeat(64),
      responses: { good: "Before", improve: "x", loved: "y" },
    };
    const manifest = buildManifest([entry]);

    entry.responses.good = "After";

    expect(lookup(manifest, "E1")?.responses.good).toBe("Before");
  });

  it.each([
    [{ kind: "reflect", question: "Synthetic question?" } as const, "question"],
    [{ kind: "cards", topic: "Synthetic topic" } as const, "topic"],
    [
      { kind: "segment-alternatives", text: "Synthetic wording" } as const,
      "text",
    ],
  ])(
    "gives a provider names and text, never an entry ID or hash (%#)",
    (words, field) => {
      const prompt = promptFor({ ...words, entries: ENTRIES }, MANIFEST);

      expect(prompt).toMatchObject({ ...words });
      expect(Object.keys(prompt).sort()).toEqual(
        ["kind", "sources", field].sort(),
      );
      expect(prompt.sources).toEqual([
        { alias: "E1", responses: E1.responses },
        { alias: "E2", responses: E2.responses },
      ]);
      const sent = JSON.stringify(prompt);
      for (const entry of ENTRIES) {
        expect(sent).not.toContain(entry.id);
        expect(sent).not.toContain(entry.contentHash);
      }
    },
  );
});

describe("a grounded Reflect answer (AI-012, AC-07, AC-26)", () => {
  const RESPONSE = {
    markdown: "You cooked together [c1] and want to interrupt less. [c2]",
    citations: [
      { claimId: "c1", evidence: [evidence()] },
      {
        claimId: "c2",
        evidence: [
          evidence("E1", "improve", "interrupt less"),
          evidence("E2", "loved", "They listened"),
        ],
      },
    ],
  };

  it("ties every citation to the real entry, its hash and where the words are", () => {
    const answer = groundReflection(RESPONSE, MANIFEST);

    expect(answer.markdown).toBe(RESPONSE.markdown);
    expect(answer.citations).toEqual([
      {
        claimId: "c1",
        evidence: [
          {
            entryId: E1.id,
            responseKey: "good",
            start: 3,
            end: 3 + QUOTE.length,
            sourceHash: E1.contentHash,
          },
        ],
      },
      {
        claimId: "c2",
        evidence: [
          {
            entryId: E1.id,
            responseKey: "improve",
            start: 10,
            end: 24,
            sourceHash: E1.contentHash,
          },
          {
            entryId: E2.id,
            responseKey: "loved",
            start: 0,
            end: 13,
            sourceHash: E2.contentHash,
          },
        ],
      },
    ]);
    // The range is the quote, exactly.
    for (const citation of answer.citations) {
      for (const ref of citation.evidence) {
        const entry = ENTRIES.find((each) => each.id === ref.entryId);
        expect(
          entry?.responses[ref.responseKey].slice(ref.start, ref.end),
        ).not.toBe("");
      }
    }
  });

  it("reports which entries were sent and what the request left out", () => {
    expect(groundReflection(RESPONSE, MANIFEST).coverage).toEqual({
      includedEntryIds: [E1.id, E2.id],
      omittedEntryCount: 0,
      truncated: false,
    });
    expect(
      groundReflection(RESPONSE, MANIFEST, {
        omittedEntryCount: 12,
        truncated: true,
      }).coverage,
    ).toEqual({
      includedEntryIds: [E1.id, E2.id],
      omittedEntryCount: 12,
      truncated: true,
    });
  });

  it("accepts an answer that says there is not enough to go on and cites nothing", () => {
    const answer = groundReflection(
      { markdown: "There is not enough here to say.", citations: [] },
      MANIFEST,
    );

    expect(answer.citations).toEqual([]);
  });

  it("accepts a quote that is a whole answer, and one a single character long", () => {
    const answer = groundReflection(
      {
        markdown: "[c1] [c2]",
        citations: [
          {
            claimId: "c1",
            evidence: [evidence("E2", "good", E2.responses.good)],
          },
          { claimId: "c2", evidence: [evidence("E1", "good", ".")] },
        ],
      },
      MANIFEST,
    );

    expect(answer.citations[0]?.evidence[0]).toMatchObject({
      start: 0,
      end: E2.responses.good.length,
    });
    expect(answer.citations[1]?.evidence[0]).toMatchObject({
      start: E1.responses.good.length - 1,
      end: E1.responses.good.length,
    });
  });
});

describe("grounded cards (AC-10, AC-26)", () => {
  it("returns checked cards with IDs made here and the entries each one quotes", () => {
    let made = 0;
    const cards = groundCards(
      {
        cards: [
          card([
            segment(),
            segment({
              category: "feeling",
              text: "I think you may have enjoyed it too.",
              evidenceKind: "inference",
              evidence: [],
            }),
          ]),
          card([
            segment({ evidence: [evidence("E2", "good", "quiet and easy")] }),
          ]),
        ],
      },
      MANIFEST,
      () => {
        made += 1;
        return `segment-${String(made)}`;
      },
    );

    expect(cards).toHaveLength(2);
    expect(cards[0]?.sourceEntryIds).toEqual([E1.id]);
    expect(cards[1]?.sourceEntryIds).toEqual([E2.id]);
    expect(cards[0]?.segments.map((each) => each.id)).toEqual([
      "segment-1",
      "segment-2",
    ]);
    expect(cards[0]?.segments[1]).toMatchObject({
      evidenceKind: "inference",
      evidence: [],
    });
    expect(cards[1]?.segments[0]?.evidence).toEqual([
      {
        entryId: E2.id,
        responseKey: "good",
        start: E2.responses.good.indexOf("quiet and easy"),
        end: E2.responses.good.indexOf("quiet and easy") + 14,
        sourceHash: E2.contentHash,
      },
    ]);
  });

  it("lists a card's entries once each, in the order they were sent", () => {
    const [made] = groundCards(
      {
        cards: [
          card([
            segment({ evidence: [evidence("E2", "good", "river")] }),
            segment({
              evidence: [evidence(), evidence("E2", "loved", "mother")],
            }),
          ]),
        ],
      },
      MANIFEST,
    );

    expect(made?.sourceEntryIds).toEqual([E1.id, E2.id]);
  });

  it("gives every part its own ID when none is supplied", () => {
    const cards = groundCards(
      { cards: [card([segment(), segment()]), card()] },
      MANIFEST,
    );
    const ids = cards.flatMap((each) => each.segments.map((part) => part.id));

    expect(new Set(ids).size).toBe(3);
  });

  it("accepts exactly three cards and exactly the most parts", () => {
    expect(
      groundCards({ cards: [card(), card(), card()] }, MANIFEST),
    ).toHaveLength(3);
    const full = Array.from({ length: LIMITS.segments }, () => segment());
    expect(
      groundCards({ cards: [card(full)] }, MANIFEST)[0]?.segments,
    ).toHaveLength(LIMITS.segments);
    expect(
      failure(() =>
        groundCards({ cards: [card([...full, segment()])] }, MANIFEST),
      ),
    ).toBeInstanceOf(MalformedResponseError);
  });
});

describe("other wordings", () => {
  it("returns one to three wordings as given", () => {
    expect(
      groundAlternatives({ alternatives: ["One.", "Two.", "Three."] }),
    ).toEqual({ alternatives: ["One.", "Two.", "Three."] });
  });
});

describe("answers that must be refused whole (AI-007, AI-012, SEC-010)", () => {
  it.each(fixture.refused)("$kind answer that $name", (refused) => {
    const error = failure(() => ground(refused.kind, refused.response));

    if (refused.error === "ungrounded") {
      expect(error).toBeInstanceOf(UngroundedCitationError);
      expect(error).toMatchObject({ reason: refused.detail });
    } else {
      expect(error).toBeInstanceOf(MalformedResponseError);
      expect(error).toMatchObject({ path: refused.detail });
    }
  });

  it("covers every kind of attack the contract names", () => {
    const names = fixture.refused.map((each) => each.name).join("\n");

    for (const needed of [
      "a name that was not sent",
      "words that are in no entry",
      "another entry's words",
      "four cards",
      "no citations field",
      "reads like an instruction",
    ]) {
      expect(names).toContain(needed);
    }
  });

  it("a name from a different request does not work in this one", () => {
    const other = buildManifest(fixture.otherRequestEntries);
    const { response } = fixture.otherRequest;

    // In the request it was written for, the answer is sound.
    expect(
      groundReflection(response, other).citations[0]?.evidence[0]?.entryId,
    ).toBe(E1.id);
    // Here, nothing was sent under that name.
    expect(failure(() => groundReflection(response, MANIFEST))).toMatchObject({
      reason: "unknown_source",
    });
  });

  it("the same name means a different entry in a different request", () => {
    const other = buildManifest(fixture.otherRequestEntries);
    const response = {
      markdown: "[c1]",
      citations: [{ claimId: "c1", evidence: [evidence()] }],
    };

    expect(groundReflection(response, MANIFEST).citations).toHaveLength(1);
    // There, E1 is another entry, which does not contain these words.
    expect(failure(() => groundReflection(response, other))).toMatchObject({
      reason: "quote_not_found",
    });
  });

  it("refuses an answer with nothing sent, whatever it cites", () => {
    const empty = buildManifest([]);

    expect(
      failure(() =>
        groundReflection(
          {
            markdown: "[c1]",
            citations: [{ claimId: "c1", evidence: [evidence()] }],
          },
          empty,
        ),
      ),
    ).toMatchObject({ reason: "unknown_source" });
    expect(
      failure(() => groundCards({ cards: [card()] }, empty)),
    ).toMatchObject({
      reason: "unknown_source",
    });
  });

  it.each([
    [
      "markdown",
      LIMITS.markdown,
      (text: string) => ({ markdown: text, citations: [] }),
    ],
  ])("holds %s to its limit, to the character", (_field, limit, make) => {
    expect(parseReflection(make("a".repeat(limit))).markdown).toHaveLength(
      limit,
    );
    expect(
      failure(() => parseReflection(make("a".repeat(limit + 1)))),
    ).toMatchObject({ path: "markdown" });
  });

  it("holds quotes, card text, themes and lists to their limits", () => {
    const long = (length: number) => "a".repeat(length);
    const over = [
      { cards: [card([segment({ text: long(LIMITS.text + 1) })])] },
      {
        cards: [
          card([segment({ teachingExplanation: long(LIMITS.text + 1) })]),
        ],
      },
      { cards: [{ ...card(), theme: long(LIMITS.theme + 1) }] },
      {
        cards: [
          card([
            segment({
              evidence: Array.from({ length: LIMITS.evidence + 1 }, () =>
                evidence(),
              ),
            }),
          ]),
        ],
      },
      {
        cards: [
          card([
            segment({
              evidence: [evidence("E1", "good", long(LIMITS.quote + 1))],
            }),
          ]),
        ],
      },
    ];

    for (const response of over) {
      expect(failure(() => groundCards(response, MANIFEST))).toBeInstanceOf(
        MalformedResponseError,
      );
    }
    expect(
      groundCards(
        {
          cards: [
            {
              ...card([
                segment({
                  text: long(LIMITS.text),
                  teachingExplanation: long(LIMITS.text),
                  evidence: Array.from({ length: LIMITS.evidence }, () =>
                    evidence(),
                  ),
                }),
              ]),
              theme: long(LIMITS.theme),
            },
          ],
        },
        MANIFEST,
      ),
    ).toHaveLength(1);
  });

  it("holds the number of cited claims to its limit", () => {
    const claims = (count: number) => ({
      markdown: Array.from(
        { length: count },
        (_, index) => `[c${String(index + 1)}]`,
      ).join(" "),
      citations: Array.from({ length: count }, (_, index) => ({
        claimId: `c${String(index + 1)}`,
        evidence: [evidence()],
      })),
    });

    expect(
      groundReflection(claims(LIMITS.citations), MANIFEST).citations,
    ).toHaveLength(LIMITS.citations);
    expect(
      failure(() => groundReflection(claims(LIMITS.citations + 1), MANIFEST)),
    ).toMatchObject({ path: "citations" });
  });

  it("says where an answer went wrong without repeating anything it said", () => {
    const canary = "CANARY words from a journal";
    const errors = [
      failure(() =>
        groundReflection(
          {
            markdown: `${canary} [c1]`,
            citations: [
              { claimId: "c1", evidence: [evidence("E1", "good", canary)] },
            ],
          },
          MANIFEST,
        ),
      ),
      failure(() =>
        groundReflection({ markdown: canary, [canary]: 1 }, MANIFEST),
      ),
      failure(() =>
        groundCards({ cards: [{ ...card(), type: canary }] }, MANIFEST),
      ),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("CANARY");
      expect(JSON.stringify(error)).not.toContain("CANARY");
    }
  });
});

describe("answer text is only ever text (SEC-010)", () => {
  it("accepts HTML, scripts and links as characters and leaves them unchanged", () => {
    const { response } = fixture.inert;

    const answer = groundReflection(response, MANIFEST);

    expect(answer.markdown).toBe(response.markdown);
  });

  it("shown as text, it makes no element, link, image or script", () => {
    const answer = groundReflection(fixture.inert.response, MANIFEST);
    const host = document.createElement("div");

    render(h("p", null, answer.markdown), host);

    expect(host.querySelectorAll("p *")).toHaveLength(0);
    expect(host.querySelector("script, img, a")).toBeNull();
    expect(host.textContent).toBe(answer.markdown);
  });
});

describe("any true quote is accepted and any altered quote is refused (AI-012)", () => {
  /** A small seeded random number generator, so every run is the same. */
  function seeded(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Includes an accent, a combining mark, an emoji and awkward punctuation.
  const ALPHABET = [..."abc déé \"'’.,\n-", "🙂", "[c1]", "<b>"];
  const KEYS: readonly ResponseKey[] = ["good", "improve", "loved"];
  /** Never in the alphabet, so adding it always makes the quote untrue. */
  const FOREIGN = "§";

  function pick<T>(random: () => number, from: readonly T[]): T {
    return from[Math.floor(random() * from.length)] as T;
  }

  function words(random: () => number): string {
    const length = 5 + Math.floor(random() * 60);
    const made = Array.from({ length }, () => pick(random, ALPHABET)).join("");
    // Never blank: a blank answer has nothing to quote.
    return `x${made}`;
  }

  function entries(random: () => number): SourceEntry[] {
    return Array.from({ length: 1 + Math.floor(random() * 5) }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      contentHash: String(index).repeat(64).slice(0, 64),
      responses: {
        good: words(random),
        improve: words(random),
        loved: words(random),
      },
    }));
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i", (seed) => {
    const random = seeded(seed);

    for (let round = 0; round < 60; round += 1) {
      const sent = entries(random);
      const manifest = buildManifest(sent);
      const index = Math.floor(random() * sent.length);
      const entry = sent[index] as SourceEntry;
      const key = pick(random, KEYS);
      const text = entry.responses[key];
      const from = Math.floor(random() * text.length);
      const to = from + 1 + Math.floor(random() * (text.length - from));
      const quote = text.slice(from, to);
      const response = (quoted: string) => ({
        markdown: "[c1]",
        citations: [
          {
            claimId: "c1",
            evidence: [{ alias: `E${String(index + 1)}`, key, quote: quoted }],
          },
        ],
      });
      if (quote.trim() === "") {
        continue;
      }

      const [ref] = groundReflection(response(quote), manifest).citations[0]
        ?.evidence ?? [undefined];

      expect(ref?.entryId).toBe(entry.id);
      expect(ref?.sourceHash).toBe(entry.contentHash);
      expect(text.slice(ref?.start, ref?.end)).toBe(quote);

      const at = Math.floor(random() * (quote.length + 1));
      const altered = quote.slice(0, at) + FOREIGN + quote.slice(at);
      expect(
        failure(() => groundReflection(response(altered), manifest)),
      ).toMatchObject({ reason: "quote_not_found" });
    }
  });
});
