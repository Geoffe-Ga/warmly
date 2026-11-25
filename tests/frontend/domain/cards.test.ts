/**
 * Conversation cards and the in-memory store behind the Prepare screens
 * (PRD CC-001, CC-007, CC-012, §7).
 */
import { describe, expect, it } from "vitest";

import { groundCards } from "../../../src/ai/grounding";
import { buildManifest } from "../../../src/ai/manifest";
import { MemoryCardsStore } from "../../../src/domain/cards/store";
import {
  CARD_TYPE_LABELS,
  readingText,
  type CardCollection,
  type CardSegment,
  type ConversationCard,
} from "../../../src/domain/cards/types";
import {
  SEED,
  SEED_CARDS_MARK,
  seededCards,
} from "../../../src/testing/seed-cards";

const WHEN = "2026-11-01T09:00:00.000Z";

function card(
  id: string,
  collectionId: string,
  texts: readonly string[],
): ConversationCard {
  return {
    id,
    collectionId,
    type: "other",
    authorship: "user_owned",
    segments: texts.map((text, index) => ({
      id: `${id}-s${String(index)}`,
      category: "other",
      text,
    })),
    sourceEntryIds: [],
    createdAt: WHEN,
    updatedAt: WHEN,
  };
}

function collection(id: string, cardIds: readonly string[]): CardCollection {
  return {
    id,
    name: `Synthetic ${id}`,
    cardIds,
    createdAt: WHEN,
    updatedAt: WHEN,
  };
}

describe("a card's reading text (CC-007)", () => {
  it("is its parts in order as plain sentences", () => {
    expect(readingText(card("k", "c", ["First.", "Second."]))).toBe(
      "First. Second.",
    );
  });

  it("leaves out empty parts and stray spaces", () => {
    expect(readingText(card("k", "c", ["  First. ", "   ", "", "Last."]))).toBe(
      "First. Last.",
    );
    expect(readingText(card("k", "c", []))).toBe("");
  });

  it("says nothing about where a part came from", async () => {
    const drafted = await seededCards().card(SEED.sunday, SEED.thanks);

    expect(drafted?.authorship).toBe("ai_generated");
    expect(drafted === undefined ? "" : readingText(drafted)).toBe(
      "I loved cooking with you on Sunday. It made me feel close to you.",
    );
  });

  it("names every kind of card", () => {
    expect(Object.keys(CARD_TYPE_LABELS).sort()).toEqual(
      ["appreciation", "curiosity", "need_request", "other"].sort(),
    );
  });
});

describe("the in-memory cards store (CC-001)", () => {
  const store = new MemoryCardsStore(
    [collection("c1", ["k2", "k1", "gone", "k3"]), collection("c2", [])],
    [
      card("k1", "c1", ["One."]),
      card("k2", "c1", ["Two."]),
      // Listed by c1 but belongs to c2: never shown under c1.
      card("k3", "c2", ["Three."]),
      // Belongs to c1 but c1 does not list it.
      card("k4", "c1", ["Four."]),
    ],
  );

  it("starts empty when given nothing", async () => {
    const empty = new MemoryCardsStore();

    expect(await empty.collections()).toEqual([]);
    expect(await empty.collection("c1")).toBeUndefined();
    expect(await empty.cards("c1")).toEqual([]);
    expect(await empty.card("c1", "k1")).toBeUndefined();
  });

  it("lists collections in the order given, and finds one by ID", async () => {
    expect((await store.collections()).map((each) => each.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect((await store.collection("c2"))?.name).toBe("Synthetic c2");
    expect(await store.collection("nope")).toBeUndefined();
  });

  it("returns a collection's cards in the collection's order", async () => {
    expect((await store.cards("c1")).map((each) => each.id)).toEqual([
      "k2",
      "k1",
    ]);
    expect(await store.cards("c2")).toEqual([]);
    expect(await store.cards("nope")).toEqual([]);
  });

  it("finds a card only through the collection it is in", async () => {
    expect((await store.card("c1", "k1"))?.id).toBe("k1");
    expect(await store.card("c2", "k1")).toBeUndefined();
    expect(await store.card("c1", "k3")).toBeUndefined();
    expect(await store.card("c1", "k4")).toBeUndefined();
    expect(await store.card("nope", "k1")).toBeUndefined();
  });
});

describe("the invented cards other builds start with", () => {
  it("are marked, so a production build can be checked for them", () => {
    expect(seededCards().mark).toBe(SEED_CARDS_MARK);
    expect(SEED_CARDS_MARK).toMatch(/^warmly\.fake\./);
  });

  it("hold three collections, one of them empty, with cards of both kinds of authorship", async () => {
    const store = seededCards();
    const sunday = await store.cards(SEED.sunday);

    expect((await store.collections()).map((each) => each.name)).toEqual([
      "Sunday talk",
      "Money check-in",
      "Not started yet",
    ]);
    expect(sunday.map((each) => each.authorship)).toEqual([
      "ai_generated",
      "user_owned",
      "user_owned",
    ]);
    expect(await store.cards(SEED.empty)).toEqual([]);
    expect((await store.card(SEED.money, SEED.budget))?.type).toBe("other");
  });

  it("never hold text copied from a journal entry, only references (DEP-004)", async () => {
    const [drafted] = await seededCards().cards(SEED.sunday);
    const refs = drafted?.segments.flatMap((each) => each.evidence ?? []);

    expect(refs).toHaveLength(1);
    expect(Object.keys(refs?.[0] ?? {}).sort()).toEqual(
      ["end", "entryId", "responseKey", "sourceHash", "start"].sort(),
    );
    expect(drafted?.sourceEntryIds).toEqual([SEED.entry]);
  });

  it("a manual card has plain parts and no AI fields", async () => {
    const manual = await seededCards().card(SEED.sunday, SEED.chores);

    expect(manual?.sourceEntryIds).toEqual([]);
    for (const part of manual?.segments ?? []) {
      expect(Object.keys(part).sort()).toEqual(["category", "id", "text"]);
    }
  });
});

describe("a checked AI answer fits the card type as it is (AI-012)", () => {
  it("its parts can be stored as card parts without conversion", () => {
    const entry = {
      id: SEED.entry,
      contentHash: "0".repeat(64),
      responses: { good: "We cooked together.", improve: "x", loved: "y" },
    };
    const [generated] = groundCards(
      {
        cards: [
          {
            type: "appreciation",
            theme: "Synthetic",
            segments: [
              {
                category: "appreciation",
                text: "I loved cooking with you.",
                evidenceKind: "paraphrase",
                teachingExplanation: "Names a moment.",
                evidence: [{ alias: "E1", key: "good", quote: "cooked" }],
              },
            ],
          },
        ],
      },
      buildManifest([entry]),
    );
    const parts: readonly CardSegment[] = generated?.segments ?? [];
    const stored: ConversationCard = {
      id: "k",
      collectionId: "c",
      type: generated?.type ?? "other",
      authorship: "ai_generated",
      segments: parts,
      sourceEntryIds: generated?.sourceEntryIds ?? [],
      createdAt: WHEN,
      updatedAt: WHEN,
    };

    expect(readingText(stored)).toBe("I loved cooking with you.");
    expect(stored.sourceEntryIds).toEqual([SEED.entry]);
  });
});
