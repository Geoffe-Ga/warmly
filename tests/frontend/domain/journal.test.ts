import { describe, expect, it } from "vitest";

import {
  CONTENT_HASH_VERSION,
  canonicalContent,
  contentHash,
} from "../../../src/domain/journal/content-hash";
import {
  FEELINGS,
  inListOrder,
  isFeeling,
} from "../../../src/domain/journal/feelings";
import {
  isJournalEntry,
  PROMPTS,
  entryDateFor,
  newEntry,
} from "../../../src/domain/journal/types";
import {
  ANSWER_NEEDED,
  canComplete,
  hasText,
  unanswered,
} from "../../../src/domain/journal/validation";
import known from "../../fixtures/journal/content-hash-v1.json";

const ANSWERS = {
  good: "We cooked together.",
  improve: "Planning weekends.",
  loved: "A note on the fridge.",
};

describe("the journal prompts (JR-001)", () => {
  it("are the three PRD questions, word for word and in order", () => {
    expect(PROMPTS.map((prompt) => prompt.label)).toEqual([
      "What's going well?",
      "What would you like to improve?",
      "Since your last journal entry, how has your partner helped you feel loved?",
    ]);
    expect(PROMPTS.map((prompt) => prompt.key)).toEqual([
      "good",
      "improve",
      "loved",
    ]);
  });
});

describe("a new journal entry (JR-001, §7)", () => {
  const now = new Date("2026-11-25T23:30:00Z");

  it("has a random ID, both timestamps, the three answers and a content hash", async () => {
    const entry = await newEntry(ANSWERS, now);

    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(entry.createdAt).toBe("2026-11-25T23:30:00.000Z");
    expect(entry.updatedAt).toBe(entry.createdAt);
    expect(entry.responses).toEqual(ANSWERS);
    expect(entry.feelings).toBeUndefined();
    expect(entry.contentHash).toBe(await contentHash(ANSWERS));
    expect((await newEntry(ANSWERS, now)).id).not.toBe(entry.id);
  });

  it("is complete only when all three answers have some text", async () => {
    expect((await newEntry(ANSWERS)).status).toBe("complete");
    expect(
      (await newEntry({ ...ANSWERS, improve: "Nothing comes to mind." }))
        .status,
    ).toBe("complete");
    for (const key of ["good", "improve", "loved"] as const) {
      expect((await newEntry({ ...ANSWERS, [key]: " \n\t" })).status).toBe(
        "draft",
      );
    }
    expect((await newEntry({ good: "", improve: "", loved: "" })).status).toBe(
      "draft",
    );
  });

  it("uses the current time and the device's time zone by default", async () => {
    const before = Date.now();

    const entry = await newEntry(ANSWERS);

    expect(Date.parse(entry.createdAt)).toBeGreaterThanOrEqual(before);
    expect(entry.entryDate.timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(entry.entryDate.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the entry date", () => {
  it("is the calendar day in the writer's time zone, which can differ from UTC's", () => {
    const lateEvening = new Date("2026-11-25T23:30:00Z");

    expect(entryDateFor(lateEvening, "UTC")).toEqual({
      date: "2026-11-25",
      timeZone: "UTC",
    });
    expect(entryDateFor(lateEvening, "Asia/Tokyo")).toEqual({
      date: "2026-11-26",
      timeZone: "Asia/Tokyo",
    });
    expect(
      entryDateFor(new Date("2026-01-01T03:00:00Z"), "America/New_York").date,
    ).toBe("2025-12-31");
  });
});

describe("the content hash (D-24)", () => {
  it("is 64 lower-case hex characters", async () => {
    expect(await contentHash(ANSWERS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(known.cases)(
    "matches the independently computed answer for $name",
    async (example) => {
      expect(known.version).toBe(CONTENT_HASH_VERSION);
      expect(canonicalContent(example.responses)).toBe(example.canonical);
      expect(await contentHash(example.responses)).toBe(example.hash);
    },
  );

  it("does not depend on the order the answers were put in the object", async () => {
    expect(
      await contentHash({
        loved: ANSWERS.loved,
        improve: ANSWERS.improve,
        good: ANSWERS.good,
      }),
    ).toBe(await contentHash(ANSWERS));
  });

  it("is the same however the accents were composed (Unicode NFC)", async () => {
    const composed = { ...ANSWERS, good: "Caf\u00e9" };
    const decomposed = { ...ANSWERS, good: "Cafe\u0301" };

    expect(decomposed.good).not.toBe(composed.good);
    expect(await contentHash(decomposed)).toBe(await contentHash(composed));
    expect(canonicalContent(decomposed)).toBe(canonicalContent(composed));
  });

  it("changes with any answer, and with which answer holds the text", async () => {
    const base = await contentHash(ANSWERS);

    expect(await contentHash({ ...ANSWERS, good: "x" })).not.toBe(base);
    expect(await contentHash({ ...ANSWERS, improve: "x" })).not.toBe(base);
    expect(await contentHash({ ...ANSWERS, loved: "x" })).not.toBe(base);
    expect(
      await contentHash({ ...ANSWERS, loved: `${ANSWERS.loved} ` }),
    ).not.toBe(base);
    expect(await contentHash({ good: "a", improve: "", loved: "" })).not.toBe(
      await contentHash({ good: "", improve: "a", loved: "" }),
    );
  });

  it("is not changed by feelings, so changing one invalidates nothing", async () => {
    const now = new Date("2026-11-25T10:00:00Z");

    expect((await newEntry(ANSWERS, now, ["calm", "sad"])).contentHash).toBe(
      (await newEntry(ANSWERS, now)).contentHash,
    );
  });

  it("carries its version inside what is hashed", () => {
    expect(canonicalContent(ANSWERS).startsWith('{"v":1,"good":')).toBe(true);
  });
});

describe("completing an entry (JR-002; AC-02)", () => {
  it.each(["", "   ", "\n\t", "\u00a0\u2003"])(
    "blocks completion when an answer is %j",
    (blank) => {
      for (const key of ["good", "improve", "loved"] as const) {
        const responses = {
          good: "ok",
          improve: "ok",
          loved: "ok",
          [key]: blank,
        };
        expect(canComplete(responses)).toBe(false);
        expect(unanswered(responses)).toEqual([key]);
      }
    },
  );

  it("accepts an explicit 'nothing' answer, and has no minimum length", () => {
    expect(
      canComplete({
        good: "Nothing comes to mind this week",
        improve: "x",
        loved: " y ",
      }),
    ).toBe(true);
    expect(hasText("no")).toBe(true);
  });

  it("lists every missing answer in prompt order", () => {
    expect(unanswered({ loved: "", good: " ", improve: "x" })).toEqual([
      "good",
      "loved",
    ]);
    expect(unanswered(ANSWERS)).toEqual([]);
  });

  it("tells the person what to do, and that 'nothing' is allowed", () => {
    expect(ANSWER_NEEDED).toMatch(/^Write something here/);
    expect(ANSWER_NEEDED).toContain("nothing comes to mind");
  });
});

describe("the feelings check-in (JR-003, D-21)", () => {
  it("offers exactly the eleven plain words, in order", () => {
    expect(FEELINGS).toEqual([
      "calm",
      "happy",
      "grateful",
      "hopeful",
      "loved",
      "tired",
      "sad",
      "anxious",
      "frustrated",
      "lonely",
      "overwhelmed",
    ]);
  });

  it("knows a listed feeling from anything else", () => {
    expect(isFeeling("calm")).toBe(true);
    expect(isFeeling("depressed")).toBe(false);
    expect(isFeeling("Calm")).toBe(false);
    expect(isFeeling(3)).toBe(false);
    expect(isFeeling(undefined)).toBe(false);
  });

  it("keeps each chosen feeling once, in list order", () => {
    expect(inListOrder(["sad", "calm", "sad"])).toEqual(["calm", "sad"]);
    expect(inListOrder([])).toEqual([]);
  });

  it("is stored on a new entry only when something was chosen", async () => {
    const now = new Date("2026-11-25T10:00:00Z");

    expect((await newEntry(ANSWERS, now, ["tired", "calm"])).feelings).toEqual([
      "calm",
      "tired",
    ]);
    expect("feelings" in (await newEntry(ANSWERS, now, []))).toBe(false);
    expect("feelings" in (await newEntry(ANSWERS, now))).toBe(false);
  });

  it("is never worked out from what was written", async () => {
    const entry = await newEntry({
      good: "I feel calm and happy and grateful",
      improve: "I am sad, anxious and overwhelmed",
      loved: "loved",
    });

    expect(entry.feelings).toBeUndefined();
  });
});

describe("checking the shape of a stored entry", () => {
  const valid = {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-11-03T09:00:00.000Z",
    updatedAt: "2026-11-03T09:00:00.000Z",
    entryDate: { date: "2026-11-03", timeZone: "UTC" },
    status: "complete",
    responses: { good: "a", improve: "", loved: "c" },
    contentHash: "0".repeat(64),
  };

  it("accepts an entry, with or without feelings, complete or draft", () => {
    expect(isJournalEntry(valid)).toBe(true);
    expect(isJournalEntry({ ...valid, feelings: [] })).toBe(true);
    expect(isJournalEntry({ ...valid, feelings: ["calm"] })).toBe(true);
    expect(isJournalEntry({ ...valid, status: "draft" })).toBe(true);
  });

  it("accepts what newEntry makes", async () => {
    expect(
      isJournalEntry(await newEntry({ good: "a", improve: "b", loved: "c" })),
    ).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["text", "entry"],
    ["a list", []],
    ["a number for the ID", { ...valid, id: 7 }],
    ["no creation time", { ...valid, createdAt: undefined }],
    ["no update time", { ...valid, updatedAt: null }],
    ["no content hash", { ...valid, contentHash: 1 }],
    ["an unknown status", { ...valid, status: "archived" }],
    ["no entry date", { ...valid, entryDate: null }],
    ["text for the entry date", { ...valid, entryDate: "2026-11-03" }],
    ["a date with no day", { ...valid, entryDate: { timeZone: "UTC" } }],
    [
      "a date that is not a calendar day",
      { ...valid, entryDate: { date: "3 Nov", timeZone: "UTC" } },
    ],
    [
      "a date that only starts like a day",
      { ...valid, entryDate: { date: "2026-11-03T00:00", timeZone: "UTC" } },
    ],
    ["no time zone", { ...valid, entryDate: { date: "2026-11-03" } }],
    [
      "a number for the time zone",
      { ...valid, entryDate: { date: "2026-11-03", timeZone: 0 } },
    ],
    ["no answers", { ...valid, responses: null }],
    ["a missing answer", { ...valid, responses: { good: "a", improve: "" } }],
    [
      "an answer that is not text",
      { ...valid, responses: { good: "a", improve: 2, loved: "c" } },
    ],
    ["feelings that are not a list", { ...valid, feelings: "calm" }],
    ["a feeling that is not text", { ...valid, feelings: ["calm", 3] }],
    ["a feeling that is not on the list", { ...valid, feelings: ["furious"] }],
  ])("refuses %s", (_name, value) => {
    expect(isJournalEntry(value)).toBe(false);
  });
});
