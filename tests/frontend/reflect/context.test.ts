/**
 * Choosing which entries go into one Reflect request (PRD RF-004, AI-016;
 * AC-09; decision D-18, ADR-0009).
 */
import { describe, expect, it } from "vitest";

import { budgetFor, contextBudget } from "../../../src/ai/budget";
import { ESTIMATE_MARGIN, POLICY_RESERVE_TOKENS } from "../../../src/ai/config";
import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  EntryTooLargeError,
  SHARES,
  selectContext,
} from "../../../src/domain/reflect/context";
import { reflectRequest } from "../../../src/domain/reflect/request";

/** Day `index` of a journal that starts on 1 January 2010. */
function dayOf(index: number): string {
  return new Date(Date.UTC(2010, 0, 1 + index)).toISOString().slice(0, 10);
}

function entry(
  index: number,
  good = `Synthetic day ${String(index)}`,
): JournalEntry {
  const date = dayOf(index);
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt: `${date}T10:00:00.000Z`,
    entryDate: { date, timeZone: "UTC" },
    updatedAt: `${date}T10:00:00.000Z`,
    status: "complete",
    responses: { good, improve: "Synthetic", loved: "Synthetic" },
    contentHash: "0".repeat(64),
  };
}

function journal(count: number): JournalEntry[] {
  return Array.from({ length: count }, (_unused, index) => entry(index));
}

/** One token for every four characters of the three answers. */
function size(one: JournalEntry): number {
  const { good, improve, loved } = one.responses;
  return Math.ceil((good.length + improve.length + loved.length) / 4);
}

function total(entries: readonly JournalEntry[]): number {
  return entries.reduce((sum, each) => sum + size(each), 0);
}

/** A small generator with a seed, so a failing case can be run again. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const QUESTION = "How have we handled chores?";

describe("choosing entries for a request (RF-004, D-18)", () => {
  it("sends everything, oldest first, when it all fits", () => {
    const entries = journal(20);

    const chosen = selectContext({
      entries: [...entries].reverse(),
      question: QUESTION,
      estimate: size,
      budget: total(entries),
    });

    expect(chosen.entries).toEqual(entries);
    expect(chosen.total).toBe(20);
    expect(chosen.coverage).toEqual({
      includedEntryIds: entries.map((each) => each.id),
      omittedEntryCount: 0,
      truncated: false,
    });
  });

  it("leaves drafts out and does not count them as omitted", () => {
    const draft = { ...entry(3), status: "draft" as const };

    const chosen = selectContext({
      entries: [entry(1), draft, entry(2)],
      question: QUESTION,
      estimate: size,
      budget: 10_000,
    });

    expect(chosen.entries.map((each) => each.id)).toEqual([
      entry(1).id,
      entry(2).id,
    ]);
    expect(chosen.total).toBe(2);
    expect(chosen.coverage.omittedEntryCount).toBe(0);
  });

  it("gives an empty selection for an empty journal", () => {
    expect(
      selectContext({
        entries: [],
        question: QUESTION,
        estimate: size,
        budget: 0,
      }),
    ).toEqual({
      entries: [],
      total: 0,
      coverage: {
        includedEntryIds: [],
        omittedEntryCount: 0,
        truncated: false,
      },
    });
  });

  it("truncates deterministically and reports omitted coverage (AC-09)", () => {
    const entries = journal(5000);
    const input = { entries, question: QUESTION, estimate: size, budget: 4000 };

    const a = selectContext(input);
    const b = selectContext(input);

    expect(a).toEqual(b);
    expect(a.coverage.truncated).toBe(true);
    expect(a.coverage.omittedEntryCount).toBe(
      5000 - a.coverage.includedEntryIds.length,
    );
    expect(a.coverage.omittedEntryCount).toBeGreaterThan(0);
    expect(a.total).toBe(5000);
    expect(total(a.entries)).toBeLessThanOrEqual(4000);
    // The budget is used, not wasted: no more than one entry's worth is left.
    expect(total(a.entries)).toBeGreaterThan(4000 - 10);
  });

  it("chooses the same entries on each of 100 runs, in whatever order the journal is given", () => {
    const entries = journal(600);
    const random = seeded(7);
    const first = selectContext({
      entries,
      question: QUESTION,
      estimate: size,
      budget: 900,
    });

    for (let run = 0; run < 100; run += 1) {
      const shuffled = [...entries].sort(() => random() - 0.5);
      expect(
        selectContext({
          entries: shuffled,
          question: QUESTION,
          estimate: size,
          budget: 900,
        }),
      ).toEqual(first);
    }
  });

  it("presents the selection oldest first", () => {
    const chosen = selectContext({
      entries: journal(500),
      question: QUESTION,
      estimate: size,
      budget: 700,
    });
    const days = chosen.entries.map((each) => each.entryDate.date);

    expect(days).toEqual([...days].sort());
  });

  it("spends most of the budget on the newest entries", () => {
    const entries = journal(1000);
    const budget = 1000;

    const chosen = selectContext({
      entries,
      question: "nothing in common",
      estimate: size,
      budget,
    });

    // The newest entries, back to where 60% of the budget runs out, are
    // all there, with no gap.
    const newest = [...entries].reverse();
    let spent = 0;
    const expected: string[] = [];
    for (const each of newest) {
      if (spent + size(each) > Math.floor(budget * SHARES.newest)) {
        break;
      }
      spent += size(each);
      expected.push(each.id);
    }
    expect(expected.length).toBeGreaterThan(10);
    expect(chosen.coverage.includedEntryIds).toEqual(
      expect.arrayContaining(expected),
    );
  });

  it("keeps some of the older journal, including its very first entry", () => {
    const entries = journal(2000);

    const chosen = selectContext({
      entries,
      question: "nothing in common",
      estimate: size,
      budget: 1500,
    });
    const positions = chosen.entries.map((each) => entries.indexOf(each));

    expect(positions[0]).toBe(0);
    // Not only the two ends: something from each quarter of the journal.
    for (const quarter of [0, 1, 2, 3]) {
      expect(
        positions.some((at) => at >= quarter * 500 && at < (quarter + 1) * 500),
        `quarter ${String(quarter)}`,
      ).toBe(true);
    }
  });

  it("brings in older entries that share words with the question", () => {
    const entries = journal(1000);
    entries[100] = entry(100, "We argued about chores and who handled them");
    entries[250] = entry(250, "Chores again");

    const chosen = selectContext({
      entries,
      question: QUESTION,
      estimate: size,
      budget: 1000,
    });
    const without = selectContext({
      entries,
      question: "nothing in common",
      estimate: size,
      budget: 1000,
    });

    expect(chosen.coverage.includedEntryIds).toContain(entry(100).id);
    expect(chosen.coverage.includedEntryIds).toContain(entry(250).id);
    expect(without.coverage.includedEntryIds).not.toContain(entry(100).id);
  });

  /**
   * Three newest entries that take the whole first part of the budget, and
   * three older candidates of which the second part can afford exactly
   * one. The third part then takes the oldest that is left, so exactly one
   * candidate is left out, and which one shows how the second part chose.
   */
  function tied(candidates: readonly JournalEntry[]): readonly string[] {
    const newest = [entry(20), entry(21), entry(22)];
    return selectContext({
      entries: [...candidates, ...newest],
      question: QUESTION,
      estimate: () => 200,
      budget: 1000,
    }).coverage.includedEntryIds;
  }

  it("prefers the entry that shares more words with the question", () => {
    const one = entry(1, "chores");
    const two = entry(2, "we handled the chores");
    const three = entry(3, "chores");

    const chosen = tied([one, two, three]);

    expect(chosen).toContain(two.id);
    expect(chosen).toContain(one.id);
    expect(chosen).not.toContain(three.id);
  });

  it("settles a tie in shared words by the newer entry", () => {
    const one = entry(1, "chores");
    const two = entry(2, "chores");
    const three = entry(3, "chores");

    const chosen = tied([one, two, three]);

    expect(chosen).toContain(three.id);
    expect(chosen).toContain(one.id);
    expect(chosen).not.toContain(two.id);
  });

  it("settles a tie between entries of the same moment by ID, whatever order they are given in", () => {
    const sameMoment = (id: string): JournalEntry => ({
      ...entry(5, "chores"),
      id,
    });
    const a = sameMoment("id-a");
    const b = sameMoment("id-b");
    const c = sameMoment("id-c");

    const chosen = tied([a, b, c]);

    expect(tied([c, a, b])).toEqual(chosen);
    expect(tied([b, c, a])).toEqual(chosen);
    // The order of the journal ends with the ID, so `id-c` counts as the
    // newest of the three and `id-a` as the oldest.
    expect(chosen).toContain(c.id);
    expect(chosen).toContain(a.id);
    expect(chosen).not.toContain(b.id);
  });

  it("refuses, naming the entry, when one entry alone is larger than the budget", () => {
    const entries = journal(10);
    const huge = entry(4, "z".repeat(10_000));
    entries[4] = huge;

    let thrown: unknown;
    try {
      selectContext({
        entries,
        question: QUESTION,
        estimate: size,
        budget: 500,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EntryTooLargeError);
    expect((thrown as EntryTooLargeError).entryId).toBe(huge.id);
    expect((thrown as EntryTooLargeError).name).toBe("EntryTooLargeError");
    // Only the ID: never the entry's text.
    expect((thrown as EntryTooLargeError).message).not.toContain("zzz");
  });

  it("accepts an entry exactly as large as the budget", () => {
    const only = entry(0, "w".repeat(382));

    const chosen = selectContext({
      entries: [only],
      question: QUESTION,
      estimate: size,
      budget: size(only),
    });

    expect(chosen.entries).toEqual([only]);
  });

  it("never sends part of an entry", () => {
    const entries = journal(300);

    const chosen = selectContext({
      entries,
      question: QUESTION,
      estimate: size,
      budget: 333,
    });

    for (const each of chosen.entries) {
      expect(entries).toContain(each);
    }
  });

  it("never chooses more than the budget, whatever the journal (property)", () => {
    const random = seeded(20261125);
    for (let run = 0; run < 300; run += 1) {
      const count = 1 + Math.floor(random() * 120);
      const entries = Array.from({ length: count }, (_unused, index) =>
        entry(
          index,
          `${random() < 0.3 ? "chores " : ""}${"a".repeat(Math.floor(random() * 400))}`,
        ),
      );
      const largest = Math.max(...entries.map(size));
      const budget = largest + Math.floor(random() * total(entries));

      const chosen = selectContext({
        entries,
        question: QUESTION,
        estimate: size,
        budget,
      });

      const label = `run ${String(run)}`;
      expect(total(chosen.entries), label).toBeLessThanOrEqual(budget);
      expect(chosen.entries.length, label).toBeGreaterThan(0);
      expect(
        chosen.coverage.omittedEntryCount + chosen.entries.length,
        label,
      ).toBe(count);
      expect(chosen.coverage.truncated, label).toBe(
        chosen.coverage.omittedEntryCount > 0,
      );
      expect(new Set(chosen.coverage.includedEntryIds).size, label).toBe(
        chosen.entries.length,
      );
      if (total(entries) <= budget) {
        expect(chosen.coverage.omittedEntryCount, label).toBe(0);
      }
    }
  });

  it("treats an estimate below one token as one, and a fractional one as the next whole", () => {
    const entries = journal(10);

    expect(
      selectContext({
        entries,
        question: QUESTION,
        estimate: () => 0,
        budget: 4,
      }).entries,
    ).toHaveLength(4);
    expect(
      selectContext({
        entries,
        question: QUESTION,
        estimate: () => 1.2,
        budget: 4.9,
      }).entries,
    ).toHaveLength(2);
  });
});

describe("the room for entries in a request (D-18)", () => {
  const budget = {
    maxInputTokens: 10_000,
    maxOutputTokens: 1_000,
    timeoutMs: 1,
  };

  it("sets aside the instructions, the answer, what else is sent, and a margin", () => {
    expect(contextBudget(budget, 500)).toBe(
      Math.floor(
        (10_000 - POLICY_RESERVE_TOKENS - 1_000 - 500) * (1 - ESTIMATE_MARGIN),
      ),
    );
    expect(ESTIMATE_MARGIN).toBe(0.15);
    expect(contextBudget(budget, 500)).toBe(5950);
  });

  it("rounds what else is sent up, and ignores a negative amount", () => {
    expect(contextBudget(budget, 0.1)).toBe(contextBudget(budget, 1));
    expect(contextBudget(budget, -50)).toBe(contextBudget(budget, 0));
  });

  it("is never less than nothing", () => {
    expect(contextBudget({ ...budget, maxInputTokens: 2_000 }, 0)).toBe(0);
  });
});

describe("a request built for a real limit (RF-004, AI-016)", () => {
  it("fits the gateway's own check, for a journal far too long to send whole", () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const sizing = gateway.sizing();
    const entries = journal(5000);

    const request = reflectRequest(QUESTION, entries, sizing);

    expect(sizing).toBeDefined();
    expect(request.entries.length).toBeGreaterThan(20);
    expect(request.entries.length).toBeLessThan(5000);
    expect(request.coverage).toEqual({
      omittedEntryCount: 5000 - request.entries.length,
      truncated: true,
    });
    const limits = budgetFor(provider.capabilities());
    const estimated = gateway.disclose(request).estimatedTokens;
    expect(estimated).toBeLessThanOrEqual(
      limits.maxInputTokens - limits.maxOutputTokens - POLICY_RESERVE_TOKENS,
    );
    expect(gateway.disclose(request).omitted).toBe(
      5000 - request.entries.length,
    );
    // Sizing sent nothing.
    expect(provider.calls).toEqual([]);
  });

  it("says nothing was left out when the whole journal fits", () => {
    const gateway = new AiGateway(new FakeProvider());

    const request = reflectRequest(QUESTION, journal(5), gateway.sizing());

    expect(request.entries).toHaveLength(5);
    expect("coverage" in request).toBe(false);
    expect(gateway.disclose(request).omitted).toBe(0);
  });

  it("does not seal the requests it sizes", () => {
    const sizing = new AiGateway(new FakeProvider()).sizing();
    const probe = { kind: "reflect" as const, question: "Why?", entries: [] };

    expect(sizing?.estimate(probe)).toBeGreaterThan(0);
    expect(Object.isFrozen(probe)).toBe(false);
  });

  it("has no sizing without a provider, and then includes every finished entry", () => {
    const sizing = new AiGateway(undefined).sizing();

    expect(sizing).toBeUndefined();
    expect(reflectRequest(QUESTION, journal(300), sizing).entries).toHaveLength(
      300,
    );
  });

  it("refuses when one entry alone cannot be sent", () => {
    const entries = journal(3);
    entries[1] = entry(1, "CANARY ".repeat(10_000));

    expect(() =>
      reflectRequest(
        QUESTION,
        entries,
        new AiGateway(new FakeProvider()).sizing(),
      ),
    ).toThrow(EntryTooLargeError);
  });
});
