/**
 * Drafting cards with AI from entries the person picked (PRD CC-001 to
 * CC-004, CC-011, AI-009 to AI-012, DEP-001, DEP-003; AC-10, AC-12, AC-26;
 * invariant 6).
 */
import { describe, expect, it } from "vitest";

import { removedText } from "../../../src/app/App";
import { POLICY_RESERVE_TOKENS } from "../../../src/ai/config";
import { grantConsent } from "../../../src/ai/consent";
import { MalformedResponseError } from "../../../src/ai/contracts";
import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { UngroundedCitationError } from "../../../src/ai/grounding";
import type { AIProvider } from "../../../src/ai/provider";
import { createCard } from "../../../src/domain/cards/cards";
import { createCollection } from "../../../src/domain/cards/collections";
import {
  NothingSelectedError,
  SelectionTooLargeError,
  cardsFrom,
  cardsRequest,
  saveGenerated,
} from "../../../src/domain/cards/generate";
import { RecordCardsStore } from "../../../src/domain/cards/store";
import { DEPENDENCY_RULES } from "../../../src/domain/dependency-rules";
import {
  Invalidator,
  findStale,
  invalidate,
} from "../../../src/domain/deps/invalidate";
import { createEventBus } from "../../../src/domain/events";
import { deleteEntry } from "../../../src/domain/journal/delete";
import { editEntry } from "../../../src/domain/journal/edit";
import { newEntry, type JournalEntry } from "../../../src/domain/journal/types";
import { MemoryRecordStore } from "../../../src/storage/record-store";
import { dependentsWarning } from "../../../src/ui/screens/journal/dependents";

async function entry(good: string, at: string): Promise<JournalEntry> {
  const made = await newEntry(
    { good, improve: "CANARY improve", loved: "CANARY loved" },
    new Date(at),
  );
  return { ...made, status: "complete" };
}

async function journal(): Promise<{
  a: JournalEntry;
  b: JournalEntry;
  c: JournalEntry;
}> {
  return {
    a: await entry("Alpha: we cooked together.", "2026-11-01T10:00:00.000Z"),
    b: await entry("Bravo: a quiet walk.", "2026-11-05T10:00:00.000Z"),
    c: await entry("Charlie: an argument.", "2026-11-09T10:00:00.000Z"),
  };
}

/** A provider that answers as the stand-in does, but with these cards. */
function answering(cards: number, base = new FakeProvider()): AIProvider {
  return {
    id: base.id,
    name: base.name,
    capabilities: () => base.capabilities(),
    validateConfig: () => base.validateConfig(),
    estimateTokens: (prompt) => base.estimateTokens(prompt),
    reflect: (prompt, signal) => base.reflect(prompt, signal),
    generateSegmentAlternatives: (prompt, signal) =>
      base.generateSegmentAlternatives(prompt, signal),
    generateCards: (prompt) =>
      Promise.resolve({
        cards: Array.from({ length: cards }, () => ({
          type: "appreciation",
          theme: "A test theme",
          segments: [
            {
              category: "appreciation",
              text: "A test card.",
              evidenceKind: "explicit",
              teachingExplanation: "A test explanation.",
              evidence: [
                {
                  alias: prompt.sources[0]?.alias ?? "",
                  key: "good",
                  quote: "we cooked together",
                },
              ],
            },
          ],
        })),
      }),
  };
}

describe("the request holds exactly what was picked (CC-001, CC-002)", () => {
  it("refuses to be built from nothing, or from a draft", async () => {
    const { a } = await journal();

    expect(() => cardsRequest([], undefined)).toThrow(NothingSelectedError);
    expect(() => cardsRequest([{ ...a, status: "draft" }], undefined)).toThrow(
      NothingSelectedError,
    );
  });

  it("refuses the whole selection when one of several picked entries is a draft", async () => {
    const { a, b } = await journal();

    expect(() =>
      cardsRequest([a, { ...b, status: "draft" }], undefined),
    ).toThrow(NothingSelectedError);
  });

  it("carries the picked entries, oldest first, and nothing else", async () => {
    const { a, b, c } = await journal();

    const request = cardsRequest([c, a], undefined);

    expect(request).toEqual({
      kind: "cards",
      topic: "",
      entries: [
        { id: a.id, contentHash: a.contentHash, responses: a.responses },
        { id: c.id, contentHash: c.contentHash, responses: c.responses },
      ],
    });
    expect(JSON.stringify(request)).not.toContain(b.responses.good);
  });

  it("sends only the entries the user ticked (CC-002, AC-10)", async () => {
    const { a, b } = await journal();
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const request = cardsRequest([a], gateway.sizing());

    await gateway.generateCards(request, grantConsent(request));

    const body = JSON.stringify(provider.calls);
    expect(provider.calls).toHaveLength(1);
    expect(body).toContain(a.responses.good);
    expect(body).not.toContain(b.responses.good);
    // A provider is given names, never an entry's ID or hash.
    expect(body).not.toContain(a.id);
    expect(body).not.toContain(a.contentHash);
  });

  it("asks for fewer entries when they do not fit, and drops none itself", async () => {
    const { a, b, c } = await journal();
    // Each entry is sized at 10 over the 5 of an empty request; the room
    // left for entries is 17, which holds one and not two.
    const sizing = {
      budget: {
        maxInputTokens: POLICY_RESERVE_TOKENS + 5 + 20,
        maxOutputTokens: 0,
        timeoutMs: 1000,
      },
      estimate: (sized: { entries: readonly unknown[] }) =>
        5 + sized.entries.length * 10,
    };

    expect(cardsRequest([a], sizing).entries).toHaveLength(1);
    expect(() => cardsRequest([a, b], sizing)).toThrow(SelectionTooLargeError);
    expect(() => cardsRequest([a, b, c], sizing)).toThrow(
      SelectionTooLargeError,
    );
  });

  it("is not built when its size cannot be worked out", async () => {
    const { a } = await journal();
    const sizing = {
      budget: { maxInputTokens: 9000, maxOutputTokens: 0, timeoutMs: 1000 },
      estimate: () => Number.NaN,
    };

    expect(() => cardsRequest([a], sizing)).toThrow(SelectionTooLargeError);
  });
});

describe("one to three cards come back, or none are accepted (CC-002, AC-10)", () => {
  it.each([1, 2, 3])(
    "accepts %i, without topping up to three",
    async (count) => {
      const { a } = await journal();
      const gateway = new AiGateway(answering(count));
      const request = cardsRequest([a], gateway.sizing());

      const cards = await gateway.generateCards(request, grantConsent(request));

      expect(cards).toHaveLength(count);
    },
  );

  it.each([0, 4])("refuses an answer of %i cards whole", async (count) => {
    const { a } = await journal();
    const gateway = new AiGateway(answering(count));
    const request = cardsRequest([a], gateway.sizing());

    await expect(
      gateway.generateCards(request, grantConsent(request)),
    ).rejects.toBeInstanceOf(MalformedResponseError);
  });

  // A quote must be in an entry that was sent, or no card is kept (PRD AC-26).
  it("refuses cards that quote words the picked entries do not hold", async () => {
    const { b } = await journal();
    // The stand-in above always quotes "we cooked together", which entry
    // B does not say.
    const gateway = new AiGateway(answering(2));
    const request = cardsRequest([b], gateway.sizing());

    await expect(
      gateway.generateCards(request, grantConsent(request)),
    ).rejects.toBeInstanceOf(UngroundedCitationError);
  });
});

async function drafted(): Promise<{
  records: MemoryRecordStore;
  collectionId: string;
  a: JournalEntry;
  b: JournalEntry;
  cards: ReturnType<typeof cardsFrom>;
}> {
  const records = new MemoryRecordStore();
  const { a, b } = await journal();
  await records.put("journal-entry", a);
  await records.put("journal-entry", b);
  const collection = await createCollection({ records }, "Sunday talk");
  await createCard({ records }, collection.id, {
    type: "other",
    text: "My own card.",
  });
  const gateway = new AiGateway(answering(2));
  const request = cardsRequest([a, b], gateway.sizing());
  const generated = await gateway.generateCards(request, grantConsent(request));
  const cards = cardsFrom(
    generated,
    request,
    collection.id,
    new Date("2026-11-20T09:00:00.000Z"),
  );
  return { records, collectionId: collection.id, a, b, cards };
}

describe("accepted cards are stored as drafted by AI, with provenance (CC-004, DEP-001)", () => {
  it("marks each card as AI's and records every entry sent, quoted or not", async () => {
    const { cards, a, b, collectionId } = await drafted();

    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toMatchObject({
        collectionId,
        authorship: "ai_generated",
        type: "appreciation",
        theme: "A test theme",
        // Only A was quoted.
        sourceEntryIds: [a.id],
        // Both were sent.
        sources: [
          { entryId: a.id, sourceHash: a.contentHash },
          { entryId: b.id, sourceHash: b.contentHash },
        ],
        createdAt: "2026-11-20T09:00:00.000Z",
      });
      expect(card.segments[0]?.evidence?.[0]).toMatchObject({
        entryId: a.id,
        responseKey: "good",
        sourceHash: a.contentHash,
      });
    }
    expect(new Set(cards.map((card) => card.id)).size).toBe(2);
  });

  it("holds references to the journal and none of its text (DEP-004)", async () => {
    const { cards, a, b } = await drafted();
    const stored = JSON.stringify(cards);

    for (const text of [
      ...Object.values(a.responses),
      ...Object.values(b.responses),
    ]) {
      expect(stored).not.toContain(text);
    }
  });

  it("adds them after the cards already in the collection, in order", async () => {
    const { records, collectionId, cards } = await drafted();

    expect(await saveGenerated({ records }, cards)).toBe(true);

    const shown = await new RecordCardsStore(records).cards(collectionId);
    expect(shown.map((card) => card.authorship)).toEqual([
      "user_owned",
      "ai_generated",
      "ai_generated",
    ]);
    expect(shown.slice(1).map((card) => card.id)).toEqual(
      cards.map((card) => card.id),
    );
  });

  it("stores the same cards once, however often it is run", async () => {
    const { records, collectionId, cards } = await drafted();

    await saveGenerated({ records }, cards);
    await saveGenerated({ records }, cards);

    expect(await records.list("conversation-card")).toHaveLength(3);
    expect(
      (await records.get("card-collection", collectionId))?.cardIds,
    ).toHaveLength(3);
  });

  it("stores nothing and changes nothing when there are no cards", async () => {
    const records = new MemoryRecordStore();

    expect(await saveGenerated({ records }, [])).toBe(true);
    expect(await records.list("conversation-card")).toEqual([]);
  });

  it("keeps the cards when their collection has gone meanwhile, and says so", async () => {
    const { records, collectionId, cards } = await drafted();
    await records.delete("card-collection", collectionId);

    expect(await saveGenerated({ records }, cards)).toBe(false);

    const strays = await new RecordCardsStore(records).strays();
    expect(strays.map((card) => card.id)).toEqual(
      expect.arrayContaining(cards.map((card) => card.id)),
    );
  });
});

describe("an unedited AI card goes when an entry it was drafted from changes (DEP-003, AC-12)", () => {
  async function saved(): Promise<Awaited<ReturnType<typeof drafted>>> {
    const made = await drafted();
    await saveGenerated({ records: made.records }, made.cards);
    return made;
  }

  it("is left alone while its entries are as they were", async () => {
    const { records } = await saved();

    expect(await findStale(records, DEPENDENCY_RULES)).toEqual([]);
  });

  it("is removed when an entry that was sent but not quoted is edited", async () => {
    const { records, b, cards } = await saved();

    await editEntry({ records, events: createEventBus() }, b.id, {
      responses: { ...b.responses, good: "Bravo, changed." },
      feelings: [],
    });
    const gone = await invalidate(records, DEPENDENCY_RULES);

    expect(gone.map((each) => each.id).sort()).toEqual(
      cards.map((card) => card.id).sort(),
    );
    // The person's own card is untouched.
    const left = await records.list("conversation-card");
    expect(left.map((card) => card.authorship)).toEqual(["user_owned"]);
  });

  it("is removed when an entry it was drafted from is deleted", async () => {
    const { records, a } = await saved();

    await deleteEntry({ records, events: createEventBus() }, a.id);

    expect(await invalidate(records, DEPENDENCY_RULES)).toHaveLength(2);
  });

  it("is still shown in order afterwards: a listed card that is gone is skipped", async () => {
    const { records, a, collectionId } = await saved();
    await deleteEntry({ records, events: createEventBus() }, a.id);
    await invalidate(records, DEPENDENCY_RULES);

    const shown = await new RecordCardsStore(records).cards(collectionId);

    expect(shown.map((card) => card.authorship)).toEqual(["user_owned"]);
  });

  it("is counted apart from reflections in what the person is told", async () => {
    const { records, a } = await saved();
    const invalidator = new Invalidator(records, DEPENDENCY_RULES);
    invalidator.start();
    await invalidator.run();
    expect(invalidator.removed).toBe(0);

    await deleteEntry({ records, events: createEventBus() }, a.id);
    await invalidator.run();

    expect(invalidator.removed).toBe(2);
    expect(invalidator.removedCards).toBe(2);
    invalidator.acknowledge();
    expect(invalidator.removedCards).toBe(0);
    invalidator.stop();
  });

  it("stops counting when it is stopped while a pass is running", async () => {
    const { records, a } = await saved();
    const invalidator = new Invalidator(records, DEPENDENCY_RULES);
    invalidator.start();
    await invalidator.run();
    await deleteEntry({ records, events: createEventBus() }, a.id);

    const pass = invalidator.run();
    invalidator.stop();
    await pass;

    // Whatever the pass removed before it finished, nothing is announced
    // after the app has locked.
    expect(invalidator.removed).toBe(0);
    expect(invalidator.removedCards).toBe(0);
  });
});

describe("the words for what was, or would be, removed", () => {
  it.each([
    [
      1,
      0,
      "A reflection was removed because a journal entry it was built from was changed or deleted.",
    ],
    [
      1,
      1,
      "A card drafted by AI was removed because a journal entry it was built from was changed or deleted.",
    ],
    [
      3,
      3,
      "3 cards drafted by AI were removed because a journal entry they were built from was changed or deleted.",
    ],
    [
      3,
      2,
      "A reflection and 2 cards drafted by AI were removed because a journal entry they were built from was changed or deleted.",
    ],
    [
      5,
      1,
      "4 reflections and a card drafted by AI were removed because a journal entry they were built from was changed or deleted.",
    ],
  ])("after: %i removed, %i of them cards", (count, cards, text) => {
    expect(removedText(count, cards)).toBe(text);
  });

  it.each([
    [
      0,
      1,
      "edit",
      "1 card drafted by AI was built from this entry. It will be removed if you change the words of your answers, because it may repeat what the entry said. Nothing is sent anywhere and nothing is written again.",
    ],
    [
      0,
      2,
      "delete",
      "2 cards drafted by AI were built from this entry. They will be removed when you delete it, because they may repeat what the entry said. Nothing is sent anywhere and nothing is written again.",
    ],
    [
      1,
      2,
      "edit",
      "1 reflection and 2 cards drafted by AI were built from this entry. They will be removed if you change the words of your answers, because they may repeat what the entry said. Nothing is sent anywhere and nothing is written again.",
    ],
  ] as const)(
    "before: %i reflections and %i cards, on %s",
    (count, cards, doing, text) => {
      expect(dependentsWarning(count, doing, "entry", cards)).toBe(text);
    },
  );
});
