/**
 * Conversation cards, their collections and the services that change them
 * (PRD CC-001, CC-007, CC-010, CC-011, DEP-004, §7; AC-13).
 */
import { describe, expect, it } from "vitest";

import { groundCards } from "../../../src/ai/grounding";
import { buildManifest } from "../../../src/ai/manifest";
import {
  InvalidCardTextError,
  MAX_CARD_TEXT,
  createCard,
  deleteCard,
  editCard,
} from "../../../src/domain/cards/cards";
import {
  InvalidNameError,
  MAX_COLLECTION_NAME,
  KEPT_CARDS_NAME,
  createCollection,
  deleteCollection,
  deleteStrayCards,
  keepStrayCards,
  keptCardsCollection,
  moveCard,
  renameCollection,
} from "../../../src/domain/cards/collections";
import { RecordCardsStore, reloadCards } from "../../../src/domain/cards/store";
import {
  CARD_TYPE_LABELS,
  isCardCollection,
  isConversationCard,
  orderCards,
  readingText,
  type CardCollection,
  type CardSegment,
  type ConversationCard,
} from "../../../src/domain/cards/types";
import { MemoryRecordStore } from "../../../src/storage/record-store";
import { CARDS, COLLECTIONS, SEED, seedCards } from "../app/seed-cards";

const WHEN = "2026-11-01T09:00:00.000Z";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const LATER = new Date("2026-11-21T08:30:00.000Z");

function card(
  id: string,
  collectionId: string,
  texts: readonly string[],
  createdAt = WHEN,
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
    createdAt,
    updatedAt: createdAt,
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

async function seeded(): Promise<{
  records: MemoryRecordStore;
  store: RecordCardsStore;
}> {
  const records = new MemoryRecordStore();
  await seedCards(records);
  return { records, store: new RecordCardsStore(records) };
}

async function texts(
  store: RecordCardsStore,
  collectionId: string,
): Promise<string[]> {
  return (await store.cards(collectionId)).map(readingText);
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

  it("says nothing about where a part came from", () => {
    const [drafted] = CARDS;

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

describe("the order of a collection's cards (CC-010)", () => {
  const cards = [
    card("k1", "c1", ["One."]),
    card("k2", "c1", ["Two."]),
    // Listed by c1 but belongs to c2: never shown under c1.
    card("k3", "c2", ["Three."]),
    // Belong to c1 but c1 does not list them: shown last, oldest first.
    card("k5", "c1", ["Five."], "2026-11-03T09:00:00.000Z"),
    card("k4", "c1", ["Four."], "2026-11-02T09:00:00.000Z"),
    card("k6", "c1", ["Six."], "2026-11-03T09:00:00.000Z"),
  ];

  it("is the collection's list, then its unlisted cards oldest first", () => {
    expect(
      orderCards(collection("c1", ["k2", "k1", "gone", "k3"]), cards).map(
        (each) => each.id,
      ),
    ).toEqual(["k2", "k1", "k4", "k5", "k6"]);
  });

  it("is empty for a collection with no cards of its own", () => {
    expect(orderCards(collection("c9", ["k1", "k2"]), cards)).toEqual([]);
    expect(orderCards(collection("c1", []), [])).toEqual([]);
  });

  it("shows a card once even if the list names it twice", () => {
    expect(
      orderCards(collection("c2", ["k3", "k3"]), cards).map((each) => each.id),
    ).toEqual(["k3"]);
  });
});

describe("what counts as a stored card or collection", () => {
  it("accepts every invented card and collection", () => {
    expect(CARDS.every(isConversationCard)).toBe(true);
    expect(COLLECTIONS.every(isCardCollection)).toBe(true);
  });

  it.each([
    ["nothing", undefined],
    ["a word", "card"],
    ["a list", [CARDS[0]]],
    ["no ID", { ...CARDS[1], id: undefined }],
    ["no collection", { ...CARDS[1], collectionId: 7 }],
    ["an unknown kind", { ...CARDS[1], type: "ultimatum" }],
    ["an unknown authorship", { ...CARDS[1], authorship: "partner" }],
    ["parts that are not a list", { ...CARDS[1], segments: "text" }],
    [
      "a part with no text",
      { ...CARDS[1], segments: [{ id: "s", category: "other" }] },
    ],
    [
      "a part with an unknown category",
      {
        ...CARDS[1],
        segments: [{ id: "s", category: "diagnosis", text: "t" }],
      },
    ],
    [
      "a part with an unknown evidence kind",
      {
        ...CARDS[0],
        segments: [{ ...CARDS[0]?.segments[0], evidenceKind: "fact" }],
      },
    ],
    [
      "evidence that is not a list",
      { ...CARDS[0], segments: [{ ...CARDS[0]?.segments[0], evidence: "E1" }] },
    ],
    [
      "evidence holding journal text instead of a reference",
      {
        ...CARDS[0],
        segments: [
          { ...CARDS[0]?.segments[0], evidence: [{ quote: "words" }] },
        ],
      },
    ],
    [
      "evidence with a negative position",
      {
        ...CARDS[0],
        segments: [
          {
            ...CARDS[0]?.segments[0],
            evidence: [
              {
                entryId: "e",
                responseKey: "good",
                start: -1,
                end: 2,
                sourceHash: "h",
              },
            ],
          },
        ],
      },
    ],
    [
      "an explanation that is not text",
      {
        ...CARDS[0],
        segments: [{ ...CARDS[0]?.segments[0], teachingExplanation: 3 }],
      },
    ],
    ["source entries that are not IDs", { ...CARDS[1], sourceEntryIds: [1] }],
    ["no dates", { ...CARDS[1], createdAt: undefined }],
  ])("refuses a card with %s", (_name, value) => {
    expect(isConversationCard(value)).toBe(false);
  });

  it.each([
    ["nothing", null],
    ["no name", { ...COLLECTIONS[0], name: undefined }],
    ["cards that are not a list", { ...COLLECTIONS[0], cardIds: "k1" }],
    ["card IDs that are not text", { ...COLLECTIONS[0], cardIds: [1] }],
    ["no dates", { ...COLLECTIONS[0], updatedAt: 5 }],
    ["a list", [COLLECTIONS[0]]],
  ])("refuses a collection with %s", (_name, value) => {
    expect(isCardCollection(value)).toBe(false);
  });

  it("a stored card holds references to the journal, never its text (DEP-004)", () => {
    const refs = CARDS[0]?.segments.flatMap((each) => each.evidence ?? []);

    expect(refs).toHaveLength(1);
    expect(Object.keys(refs?.[0] ?? {}).sort()).toEqual(
      ["end", "entryId", "responseKey", "sourceHash", "start"].sort(),
    );
  });
});

describe("the cards store over the private records (CC-001, SYNC-001)", () => {
  it("is empty when nothing has been written", async () => {
    const store = new RecordCardsStore(new MemoryRecordStore());

    expect(await store.collections()).toEqual([]);
    expect(await store.collection("c1")).toBeUndefined();
    expect(await store.cards("c1")).toEqual([]);
    expect(await store.card("c1", "k1")).toBeUndefined();
  });

  it("lists collections oldest first, and finds one by ID", async () => {
    const { store } = await seeded();

    expect((await store.collections()).map((each) => each.name)).toEqual([
      "Sunday talk",
      "Money check-in",
      "Not started yet",
    ]);
    expect((await store.collection(SEED.money))?.name).toBe("Money check-in");
    expect(await store.collection("nope")).toBeUndefined();
  });

  it("returns a collection's cards in order", async () => {
    const { store } = await seeded();

    expect((await store.cards(SEED.sunday)).map((each) => each.id)).toEqual([
      SEED.thanks,
      SEED.chores,
      SEED.wondering,
    ]);
    expect(await store.cards(SEED.empty)).toEqual([]);
    expect(await store.cards("nope")).toEqual([]);
  });

  it("finds a card only through the collection it is in", async () => {
    const { store, records } = await seeded();

    expect((await store.card(SEED.sunday, SEED.chores))?.id).toBe(SEED.chores);
    expect(await store.card(SEED.money, SEED.chores)).toBeUndefined();
    expect(await store.card("nope", SEED.chores)).toBeUndefined();
    expect(await store.card(SEED.sunday, "nope")).toBeUndefined();
    // A card whose collection has gone is not shown either.
    await records.delete("card-collection", SEED.money);
    expect(await store.card(SEED.money, SEED.budget)).toBeUndefined();
  });

  it("tells a listener when the records change, until it stops listening", async () => {
    const { store, records } = await seeded();
    let told = 0;
    const stop = store.subscribe(() => {
      told += 1;
    });

    await createCollection({ records }, "Synthetic");
    expect(told).toBe(1);
    stop();
    await createCollection({ records }, "Synthetic again");
    expect(told).toBe(1);
  });
});

describe("making and renaming a collection (CC-001)", () => {
  it("makes an empty collection with the name given, trimmed", async () => {
    const records = new MemoryRecordStore();

    const made = await createCollection({ records }, "  Sunday talk ", NOW);

    expect(made).toEqual({
      id: made.id,
      name: "Sunday talk",
      cardIds: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(made.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await records.get("card-collection", made.id)).toEqual(made);
  });

  it("gives every collection its own ID, even with the same name", async () => {
    const records = new MemoryRecordStore();

    const [a, b] = [
      await createCollection({ records }, "Same"),
      await createCollection({ records }, "Same"),
    ];

    expect(a.id).not.toBe(b.id);
    expect(await records.list("card-collection")).toHaveLength(2);
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   \n "],
    ["too long", "n".repeat(MAX_COLLECTION_NAME + 1)],
  ])("refuses a name that is %s, and stores nothing", async (_name, name) => {
    const { records } = await seeded();

    await expect(createCollection({ records }, name)).rejects.toThrow(
      InvalidNameError,
    );
    await expect(
      renameCollection({ records }, SEED.sunday, name),
    ).rejects.toThrow(InvalidNameError);

    expect(await records.list("card-collection")).toHaveLength(3);
    expect((await records.get("card-collection", SEED.sunday))?.name).toBe(
      "Sunday talk",
    );
  });

  it("accepts a name of exactly the longest length", async () => {
    const records = new MemoryRecordStore();
    const name = "n".repeat(MAX_COLLECTION_NAME);

    expect((await createCollection({ records }, name)).name).toBe(name);
  });

  it("renames a collection and leaves its cards and creation time alone", async () => {
    const { records, store } = await seeded();

    const renamed = await renameCollection(
      { records },
      SEED.sunday,
      " Weekend talk ",
      NOW,
    );

    expect(renamed).toMatchObject({
      id: SEED.sunday,
      name: "Weekend talk",
      cardIds: [SEED.thanks, SEED.chores, SEED.wondering],
      createdAt: WHEN,
      updatedAt: NOW.toISOString(),
    });
    expect(await store.collection(SEED.sunday)).toEqual(renamed);
    expect(await store.cards(SEED.sunday)).toHaveLength(3);
  });

  it("renaming a collection that is not here changes nothing", async () => {
    const { records } = await seeded();

    expect(await renameCollection({ records }, "nope", "Name")).toBeUndefined();
    expect(await records.list("card-collection")).toHaveLength(3);
  });
});

describe("deleting a collection (CC-010)", () => {
  it("deletes every card in it, and the collection, and nothing else", async () => {
    const { records, store } = await seeded();
    // A card that belongs to the collection but is not in its list.
    await records.put(
      "conversation-card",
      card("unlisted", SEED.sunday, ["Unlisted."]),
    );

    expect(await deleteCollection({ records }, SEED.sunday)).toBe(4);

    expect(await store.collection(SEED.sunday)).toBeUndefined();
    expect(
      (await records.list("conversation-card")).map((each) => each.id),
    ).toEqual([SEED.budget]);
    expect((await store.collections()).map((each) => each.id)).toEqual([
      SEED.money,
      SEED.empty,
    ]);
  });

  it("deletes an empty collection", async () => {
    const { records, store } = await seeded();

    expect(await deleteCollection({ records }, SEED.empty)).toBe(0);
    expect(await store.collection(SEED.empty)).toBeUndefined();
    expect(await records.list("conversation-card")).toHaveLength(4);
  });

  it("says so when there is nothing to delete", async () => {
    const { records } = await seeded();

    expect(await deleteCollection({ records }, "nope")).toBeUndefined();
    expect(await records.list("card-collection")).toHaveLength(3);
  });

  it("can be finished by asking again if it stopped part-way", async () => {
    const { records, store } = await seeded();
    const remove = records.delete.bind(records);
    let calls = 0;
    records.delete = (kind, id) => {
      calls += 1;
      return calls === 2
        ? Promise.reject(new Error("synthetic"))
        : remove(kind, id);
    };

    await expect(deleteCollection({ records }, SEED.sunday)).rejects.toThrow(
      "synthetic",
    );
    // The collection is still there, with the cards not yet deleted.
    expect(await store.cards(SEED.sunday)).toHaveLength(2);

    expect(await deleteCollection({ records }, SEED.sunday)).toBe(2);
    expect(await store.collection(SEED.sunday)).toBeUndefined();
  });
});

describe("writing a card by hand (CC-010, CC-011)", () => {
  it("adds a plain card of the person's own at the end of the collection", async () => {
    const { records, store } = await seeded();

    const made = await createCard(
      { records },
      SEED.sunday,
      { type: "curiosity", text: "  How was your week?  " },
      NOW,
    );

    expect(made).toEqual({
      id: made?.id,
      collectionId: SEED.sunday,
      type: "curiosity",
      authorship: "user_owned",
      segments: [
        {
          id: made?.segments[0]?.id,
          category: "other",
          text: "How was your week?",
        },
      ],
      sourceEntryIds: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(Object.keys(made?.segments[0] ?? {}).sort()).toEqual([
      "category",
      "id",
      "text",
    ]);
    expect((await texts(store, SEED.sunday)).at(-1)).toBe("How was your week?");
    expect((await store.collection(SEED.sunday))?.cardIds.at(-1)).toBe(
      made?.id,
    );
    expect((await store.collection(SEED.sunday))?.updatedAt).toBe(
      NOW.toISOString(),
    );
  });

  it("keeps the words exactly as written: no correcting and no judging", async () => {
    const { records } = await seeded();
    const words = "u NEVER listen!!  ok\nfine. <b>whatever</b> 🙃";

    const made = await createCard({ records }, SEED.empty, {
      type: "other",
      text: words,
    });

    expect(made?.segments[0]?.text).toBe(words);
  });

  it.each([
    ["empty", ""],
    ["only spaces", " \n\t "],
    ["too long", "x".repeat(MAX_CARD_TEXT + 1)],
  ])("refuses text that is %s, and stores nothing", async (_name, text) => {
    const { records } = await seeded();

    await expect(
      createCard({ records }, SEED.sunday, { type: "other", text }),
    ).rejects.toThrow(InvalidCardTextError);
    await expect(
      editCard({ records }, SEED.chores, { type: "other", text }),
    ).rejects.toThrow(InvalidCardTextError);

    expect(await records.list("conversation-card")).toHaveLength(4);
  });

  it("accepts text of exactly the longest length", async () => {
    const { records } = await seeded();
    const text = "x".repeat(MAX_CARD_TEXT);

    const made = await createCard({ records }, SEED.empty, {
      type: "other",
      text,
    });

    expect(made?.segments[0]?.text).toHaveLength(MAX_CARD_TEXT);
  });

  it("does not add a card to a collection that is not here", async () => {
    const { records } = await seeded();

    expect(
      await createCard({ records }, "nope", { type: "other", text: "Text" }),
    ).toBeUndefined();
    expect(await records.list("conversation-card")).toHaveLength(4);
  });

  it("a card is still shown if its collection's list was never updated", async () => {
    const { records, store } = await seeded();
    const put = records.put.bind(records);
    records.put = (kind, record) =>
      kind === "card-collection"
        ? Promise.reject(new Error("synthetic"))
        : put(kind, record);

    await expect(
      createCard({ records }, SEED.sunday, { type: "other", text: "Kept." }),
    ).rejects.toThrow("synthetic");

    expect(await texts(store, SEED.sunday)).toHaveLength(4);
    expect((await texts(store, SEED.sunday)).at(-1)).toBe("Kept.");
  });

  it("holds 200 cards in one collection, in order, and can move one (CC-011)", async () => {
    const records = new MemoryRecordStore();
    const store = new RecordCardsStore(records);
    const made = await createCollection({ records }, "Many");
    for (let index = 1; index <= 200; index += 1) {
      await createCard({ records }, made.id, {
        type: "other",
        text: `Card ${String(index)}`,
      });
    }

    expect(await texts(store, made.id)).toEqual(
      Array.from({ length: 200 }, (_, index) => `Card ${String(index + 1)}`),
    );
    const last = (await store.cards(made.id)).at(-1);
    expect(await moveCard({ records }, made.id, last?.id ?? "", 1)).toEqual({
      position: 1,
      total: 200,
    });
    expect((await texts(store, made.id)).slice(0, 3)).toEqual([
      "Card 200",
      "Card 1",
      "Card 2",
    ]);
  });
});

describe("changing and deleting a card (CC-010)", () => {
  it("changes the kind and the words of the person's own card, and nothing else", async () => {
    const { records, store } = await seeded();
    const before = await store.card(SEED.sunday, SEED.wondering);

    const changed = await editCard(
      { records },
      SEED.wondering,
      { type: "need_request", text: " Could we talk on Friday? " },
      { now: LATER },
    );

    expect(changed).toEqual({
      ...before,
      type: "need_request",
      segments: [
        {
          id: before?.segments[0]?.id,
          category: "other",
          text: "Could we talk on Friday?",
        },
      ],
      updatedAt: LATER.toISOString(),
    });
    expect(await store.card(SEED.sunday, SEED.wondering)).toEqual(changed);
    // The collection is not written: only the card changed.
    expect((await store.collection(SEED.sunday))?.updatedAt).toBe(WHEN);
  });

  it("makes a card of several parts into one plain part", async () => {
    const { records } = await seeded();

    const changed = await editCard({ records }, SEED.chores, {
      type: "need_request",
      text: "One sentence now.",
    });

    expect(changed?.segments).toHaveLength(1);
    expect(changed === undefined ? "" : readingText(changed)).toBe(
      "One sentence now.",
    );
  });

  it("gives a card with no parts a first part", async () => {
    const { records } = await seeded();
    await records.put("conversation-card", card("bare", SEED.sunday, []));

    const changed = await editCard({ records }, "bare", {
      type: "other",
      text: "Now it says something.",
    });

    expect(changed?.segments[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does nothing for a card that is not here", async () => {
    const { records } = await seeded();

    expect(
      await editCard({ records }, "nope", { type: "other", text: "Text" }),
    ).toBeUndefined();
  });

  it("leaves a card AI drafted as it is when it is saved with nothing changed (D-15)", async () => {
    const { records, store } = await seeded();
    const drafted = await store.card(SEED.sunday, SEED.thanks);

    const same = await editCard({ records }, SEED.thanks, {
      type: "appreciation",
      text: "I loved cooking with you on Sunday. It made me feel close to you.",
    });

    expect(same).toEqual(drafted);
    expect(await store.card(SEED.sunday, SEED.thanks)).toEqual(drafted);
  });

  it("makes a card AI drafted the person's own when it is rewritten, with no AI notes left (CC-008)", async () => {
    const { records, store } = await seeded();

    await editCard({ records }, SEED.thanks, { type: "other", text: "Text" });

    const now = await store.card(SEED.sunday, SEED.thanks);
    expect(now?.authorship).toBe("user_owned");
    expect(now?.sourceEntryIds).toEqual([]);
    expect(now?.segments).toHaveLength(1);
    expect(now?.segments[0]).toMatchObject({ category: "other", text: "Text" });
    expect(Object.keys(now?.segments[0] ?? {}).sort()).toEqual([
      "category",
      "id",
      "text",
    ]);
  });

  it("deletes a card and takes it out of its collection's list", async () => {
    const { records, store } = await seeded();

    expect(await deleteCard({ records }, SEED.chores, NOW)).toBe(true);

    expect(await store.card(SEED.sunday, SEED.chores)).toBeUndefined();
    expect((await store.collection(SEED.sunday))?.cardIds).toEqual([
      SEED.thanks,
      SEED.wondering,
    ]);
    expect((await store.collection(SEED.sunday))?.updatedAt).toBe(
      NOW.toISOString(),
    );
    expect(await deleteCard({ records }, SEED.chores)).toBe(false);
  });

  it("deletes a card that its collection did not list, without writing the collection", async () => {
    const { records, store } = await seeded();
    await records.put("conversation-card", card("extra", SEED.sunday, ["x"]));

    expect(await deleteCard({ records }, "extra", NOW)).toBe(true);

    expect((await store.collection(SEED.sunday))?.updatedAt).toBe(WHEN);
    expect(await store.cards(SEED.sunday)).toHaveLength(3);
  });

  it("deletes a card whose collection has already gone", async () => {
    const { records } = await seeded();
    await records.delete("card-collection", SEED.money);

    expect(await deleteCard({ records }, SEED.budget)).toBe(true);
    expect(await records.get("conversation-card", SEED.budget)).toBeUndefined();
  });
});

describe("moving a card (CC-010, AC-13)", () => {
  async function order(store: RecordCardsStore): Promise<string[]> {
    return (await store.cards(SEED.sunday)).map((each) => each.id);
  }

  it("moves a card down one place and says where it is now", async () => {
    const { records, store } = await seeded();

    expect(
      await moveCard({ records }, SEED.sunday, SEED.thanks, 2, NOW),
    ).toEqual({ position: 2, total: 3 });

    expect(await order(store)).toEqual([
      SEED.chores,
      SEED.thanks,
      SEED.wondering,
    ]);
    expect((await store.collection(SEED.sunday))?.updatedAt).toBe(
      NOW.toISOString(),
    );
  });

  it("moves a card up, to the start and to the end", async () => {
    const { records, store } = await seeded();

    await moveCard({ records }, SEED.sunday, SEED.wondering, 2);
    expect(await order(store)).toEqual([
      SEED.thanks,
      SEED.wondering,
      SEED.chores,
    ]);
    await moveCard({ records }, SEED.sunday, SEED.chores, 1);
    expect(await order(store)).toEqual([
      SEED.chores,
      SEED.thanks,
      SEED.wondering,
    ]);
    await moveCard({ records }, SEED.sunday, SEED.chores, 3);
    expect(await order(store)).toEqual([
      SEED.thanks,
      SEED.wondering,
      SEED.chores,
    ]);
  });

  it.each([
    [0, 1],
    [-5, 1],
    [4, 3],
    [99, 3],
    [2.9, 2],
  ])("brings a place of %d to %d", async (to, position) => {
    const { records } = await seeded();

    expect(await moveCard({ records }, SEED.sunday, SEED.chores, to)).toEqual({
      position,
      total: 3,
    });
  });

  it("writes nothing when the card is already there", async () => {
    const { records, store } = await seeded();

    expect(
      await moveCard({ records }, SEED.sunday, SEED.thanks, 1, NOW),
    ).toEqual({ position: 1, total: 3 });
    expect(
      await moveCard({ records }, SEED.sunday, SEED.thanks, 0, NOW),
    ).toEqual({ position: 1, total: 3 });

    expect((await store.collection(SEED.sunday))?.updatedAt).toBe(WHEN);
  });

  it("does nothing for a collection or card that is not here, or a card from another collection", async () => {
    const { records, store } = await seeded();

    expect(await moveCard({ records }, "nope", SEED.thanks, 2)).toBeUndefined();
    expect(await moveCard({ records }, SEED.sunday, "nope", 2)).toBeUndefined();
    expect(
      await moveCard({ records }, SEED.sunday, SEED.budget, 1),
    ).toBeUndefined();
    expect(await order(store)).toEqual([
      SEED.thanks,
      SEED.chores,
      SEED.wondering,
    ]);
  });

  it("lists an unlisted card once it has been moved, and drops IDs of cards that are gone", async () => {
    const { records, store } = await seeded();
    await records.put(
      "conversation-card",
      card("extra", SEED.sunday, ["Extra."], "2026-11-09T09:00:00.000Z"),
    );
    await records.delete("conversation-card", SEED.chores);

    expect(await moveCard({ records }, SEED.sunday, "extra", 1)).toEqual({
      position: 1,
      total: 3,
    });

    expect((await store.collection(SEED.sunday))?.cardIds).toEqual([
      "extra",
      SEED.thanks,
      SEED.wondering,
    ]);
  });
});

describe("cards that belong to no collection are never hidden (CC-010)", () => {
  /** A collection deleted elsewhere, with a card that was added to it late. */
  async function withStrays() {
    const made = await seeded();
    await made.records.put(
      "conversation-card",
      card("late-2", "gone", ["Second stray."], "2026-11-12T09:00:00.000Z"),
    );
    await made.records.put(
      "conversation-card",
      card("late-1", "gone", ["First stray."], "2026-11-11T09:00:00.000Z"),
    );
    return made;
  }

  it("lists none when every card's collection is here", async () => {
    const { store } = await seeded();

    expect(await store.strays()).toEqual([]);
  });

  it("lists cards whose collection is gone, oldest first", async () => {
    const { store } = await withStrays();

    expect((await store.strays()).map(readingText)).toEqual([
      "First stray.",
      "Second stray.",
    ]);
  });

  it("keeps them, when asked, in a collection for kept cards, and nothing else moves", async () => {
    const { records, store } = await withStrays();

    expect(await keepStrayCards({ records }, ["late-1", "late-2"], NOW)).toBe(
      2,
    );

    expect(await store.strays()).toEqual([]);
    const kept = (await store.collections()).find(
      (each) => each.name === KEPT_CARDS_NAME,
    );
    expect(await texts(store, kept?.id ?? "")).toEqual([
      "First stray.",
      "Second stray.",
    ]);
    expect(await texts(store, SEED.sunday)).toHaveLength(3);
    expect((await records.get("conversation-card", "late-1"))?.updatedAt).toBe(
      NOW.toISOString(),
    );
  });

  it("uses a collection for kept cards that already exists, and makes only one", async () => {
    const { records, store } = await withStrays();
    const first = await keptCardsCollection({ records }, NOW);

    expect((await keptCardsCollection({ records })).id).toBe(first.id);
    await keepStrayCards({ records }, ["late-1", "late-2"]);

    expect(
      (await store.collections()).filter(
        (each) => each.name === KEPT_CARDS_NAME,
      ),
    ).toHaveLength(1);
    expect(await texts(store, first.id)).toHaveLength(2);
  });

  it("does nothing, and makes no collection, when there are none to keep", async () => {
    const { records, store } = await seeded();

    expect(await keepStrayCards({ records }, ["late-1", "late-2"])).toBe(0);
    expect(await deleteStrayCards({ records }, ["late-1", "late-2"])).toBe(0);

    expect(await store.collections()).toHaveLength(3);
  });

  it("deletes them, when asked, and only them", async () => {
    const { records, store } = await withStrays();

    expect(await deleteStrayCards({ records }, ["late-1", "late-2"])).toBe(2);

    expect(await store.strays()).toEqual([]);
    expect(await records.list("conversation-card")).toHaveLength(4);
  });

  it("acts only on the cards the person was shown, not one that arrived meanwhile", async () => {
    const { records, store } = await withStrays();

    // The person saw one stray; another has arrived since.
    expect(await keepStrayCards({ records }, ["late-1"], NOW)).toBe(1);
    expect((await store.strays()).map((each) => each.id)).toEqual(["late-2"]);

    expect(await deleteStrayCards({ records }, ["late-1", "nope"])).toBe(0);
    expect((await store.strays()).map((each) => each.id)).toEqual(["late-2"]);
    // A card that is in a collection is never touched, even if named.
    expect(await deleteStrayCards({ records }, [SEED.chores])).toBe(0);
    expect(await keepStrayCards({ records }, [SEED.chores])).toBe(0);
    expect(await texts(store, SEED.sunday)).toHaveLength(3);
  });

  it("reading everything again asks the store for every collection and card", async () => {
    const { records } = await seeded();
    const asked: string[] = [];
    const reload = records.reload.bind(records);
    records.reload = ((kind: "card-collection", id: string) => {
      asked.push(`${kind}/${id}`);
      return reload(kind, id);
    }) as typeof records.reload;

    await reloadCards(records);

    expect(asked).toHaveLength(3 + 4);
    expect(
      asked.filter((each) => each.startsWith("card-collection/")),
    ).toHaveLength(3);
  });

  it("a card added while its collection was being deleted is left as a stray, not lost", async () => {
    const { records, store } = await seeded();
    const list = records.list.bind(records);
    let added = false;
    // Another tab adds a card just after the collection's cards are read.
    records.list = (async (kind: "conversation-card") => {
      const found = await list(kind);
      if (kind === "conversation-card" && !added) {
        added = true;
        await records.put(
          "conversation-card",
          card("racing", SEED.sunday, ["Written at the same moment."]),
        );
      }
      return found;
    }) as typeof records.list;

    await deleteCollection({ records }, SEED.sunday);

    expect((await store.strays()).map(readingText)).toEqual([
      "Written at the same moment.",
    ]);
  });
});

describe("lengths are counted as a person sees them", () => {
  it("an emoji counts as one character in a name and in a card", async () => {
    const records = new MemoryRecordStore();
    const name = "🙂".repeat(MAX_COLLECTION_NAME);
    const made = await createCollection({ records }, name);

    expect(made.name).toBe(name);
    await expect(createCollection({ records }, `${name}🙂`)).rejects.toThrow(
      InvalidNameError,
    );
    const full = await createCard({ records }, made.id, {
      type: "other",
      text: "🙂".repeat(MAX_CARD_TEXT),
    });
    expect(full).toBeDefined();
    await expect(
      createCard({ records }, made.id, {
        type: "other",
        text: "🙂".repeat(MAX_CARD_TEXT + 1),
      }),
    ).rejects.toThrow(InvalidCardTextError);
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

    expect(isConversationCard(stored)).toBe(true);
    expect(readingText(stored)).toBe("I loved cooking with you.");
    expect(stored.sourceEntryIds).toEqual([SEED.entry]);
  });
});
