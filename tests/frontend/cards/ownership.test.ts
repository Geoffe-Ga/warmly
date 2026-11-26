/**
 * Whose a card is, and what happens to it when its sources change (PRD
 * CC-007 to CC-009, DEP-001, DEP-003, DEP-004, DEP-005; AC-12, AC-26;
 * decision D-15; ADR-0010).
 */
import { describe, expect, it } from "vitest";

import { chooseAlternative } from "../../../src/domain/cards/alternatives";
import {
  InvalidCardTextError,
  createCard,
  editCard,
} from "../../../src/domain/cards/cards";
import {
  createCollection,
  moveCard,
} from "../../../src/domain/cards/collections";
import { hasAiNotes, rewriteParts } from "../../../src/domain/cards/ownership";
import type { ConversationCard } from "../../../src/domain/cards/types";
import { DEPENDENCY_RULES } from "../../../src/domain/dependency-rules";
import { buildIndex } from "../../../src/domain/deps/index";
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

const MADE = "2026-11-04T09:00:00.000Z";
const LATER = new Date("2026-11-06T09:00:00.000Z");
const OLD_WORDS = "CANARY we cooked dinner together on Sunday";

async function entry(good: string, at: string): Promise<JournalEntry> {
  const made = await newEntry(
    { good, improve: "CANARY improve", loved: "CANARY loved" },
    new Date(at),
  );
  return { ...made, status: "complete" };
}

async function setUp(): Promise<{
  records: MemoryRecordStore;
  quoted: JournalEntry;
  sent: JournalEntry;
  card: ConversationCard;
  collectionId: string;
}> {
  const records = new MemoryRecordStore();
  const quoted = await entry(OLD_WORDS, "2026-11-01T10:00:00.000Z");
  const sent = await entry("CANARY a quiet walk", "2026-11-02T10:00:00.000Z");
  await records.put("journal-entry", quoted);
  await records.put("journal-entry", sent);
  const collection = await createCollection({ records }, "Sunday talk");
  const card: ConversationCard = {
    id: "00000000-0000-4000-8000-0000000000a1",
    collectionId: collection.id,
    type: "appreciation",
    authorship: "ai_generated",
    theme: "Dinner",
    segments: [
      {
        id: "s1",
        category: "appreciation",
        text: "I loved cooking with you.",
        evidenceKind: "explicit",
        teachingExplanation: "Naming one moment is easier to hear.",
        evidence: [
          {
            entryId: quoted.id,
            responseKey: "good",
            start: 7,
            end: 23,
            sourceHash: quoted.contentHash,
          },
        ],
      },
      {
        id: "s2",
        category: "feeling",
        text: "It made me feel close to you.",
        evidenceKind: "inference",
        teachingExplanation: "Saying how it felt says why it mattered.",
        evidence: [],
      },
    ],
    sourceEntryIds: [quoted.id],
    sources: [
      { entryId: quoted.id, sourceHash: quoted.contentHash },
      { entryId: sent.id, sourceHash: sent.contentHash },
    ],
    createdAt: MADE,
    updatedAt: MADE,
  };
  await records.put("conversation-card", card);
  await records.put("card-collection", {
    ...collection,
    cardIds: [card.id],
  });
  return { records, quoted, sent, card, collectionId: collection.id };
}

const events = createEventBus();

function parts(card: ConversationCard, changes: Record<string, string> = {}) {
  return card.segments.map((segment) => ({
    id: segment.id,
    text: changes[segment.id] ?? segment.text,
  }));
}

describe("the first saved change makes an AI card the person's own (CC-008, D-15)", () => {
  it("changes ownership when one part is rewritten, and that part alone loses its AI notes", async () => {
    const { records, card, quoted } = await setUp();

    const changed = await rewriteParts(
      { records },
      card.id,
      { type: card.type, parts: parts(card, { s2: "I felt close to you." }) },
      LATER,
    );

    expect(changed?.authorship).toBe("user_owned");
    expect(changed?.segments).toEqual([
      card.segments[0],
      { id: "s2", category: "feeling", text: "I felt close to you." },
    ]);
    expect(changed?.updatedAt).toBe(LATER.toISOString());
    // The untouched part still rests on the journal, so the card still
    // records what it was drafted from.
    expect(changed?.sourceEntryIds).toEqual([quoted.id]);
    expect(changed?.sources).toEqual(card.sources);
    expect(await records.get("conversation-card", card.id)).toEqual(changed);
  });

  it("keeps no reference at all once no part has AI notes left (DEP-004)", async () => {
    const { records, card } = await setUp();

    const changed = await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s1: "Thank you for dinner.", s2: "I felt close." }),
    });

    expect(changed?.segments).toEqual([
      { id: "s1", category: "appreciation", text: "Thank you for dinner." },
      { id: "s2", category: "feeling", text: "I felt close." },
    ]);
    expect(changed?.sourceEntryIds).toEqual([]);
    expect(changed !== undefined && "sources" in changed).toBe(false);
    expect(changed !== undefined && "theme" in changed).toBe(false);
    expect(changed !== undefined && hasAiNotes(changed)).toBe(false);
  });

  it("changes nothing, and no ownership, when Save is pressed with nothing changed", async () => {
    const { records, card } = await setUp();

    const same = await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card),
    });

    expect(same).toEqual(card);
    expect(await records.get("conversation-card", card.id)).toEqual(card);
  });

  it("counts a change of kind as a change", async () => {
    const { records, card } = await setUp();

    const changed = await rewriteParts({ records }, card.id, {
      type: "other",
      parts: parts(card),
    });

    expect(changed?.authorship).toBe("user_owned");
    expect(changed?.type).toBe("other");
    // No words changed, so every part keeps its notes.
    expect(changed?.segments).toEqual(card.segments);
  });

  it("removes a part that is emptied, which is a change too", async () => {
    const { records, card } = await setUp();

    const changed = await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "   " }),
    });

    expect(changed?.authorship).toBe("user_owned");
    expect(changed?.segments).toEqual([card.segments[0]]);
  });

  it("refuses to leave a card with no words, or with a part that is too long", async () => {
    const { records, card } = await setUp();

    await expect(
      rewriteParts({ records }, card.id, {
        type: card.type,
        parts: parts(card, { s1: "", s2: " " }),
      }),
    ).rejects.toBeInstanceOf(InvalidCardTextError);
    await expect(
      rewriteParts({ records }, card.id, {
        type: card.type,
        parts: parts(card, { s1: "x".repeat(4001) }),
      }),
    ).rejects.toBeInstanceOf(InvalidCardTextError);
    expect(await records.get("conversation-card", card.id)).toEqual(card);
  });

  it("applies no check to the person's wording: anything they type is kept as typed", async () => {
    const { records, card } = await setUp();
    const blunt = "You NEVER listen!!  (and i mean it)";

    const changed = await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s1: blunt }),
    });

    expect(changed?.segments[0]?.text).toBe(blunt);
  });

  it("does nothing for a card that is not here", async () => {
    const { records, card } = await setUp();

    expect(
      await rewriteParts({ records }, "00000000-0000-4000-8000-00000000dead", {
        type: "other",
        parts: parts(card),
      }),
    ).toBeUndefined();
  });

  it("is one-way: a later change leaves it the person's own", async () => {
    const { records, card } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "Mine." }),
    });

    const again = await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "It made me feel close to you." }),
    });

    expect(again?.authorship).toBe("user_owned");
    // The AI's notes on that part do not come back with its old words.
    expect(again?.segments[1]).toEqual({
      id: "s2",
      category: "feeling",
      text: "It made me feel close to you.",
    });
  });

  it("rewriting the whole card as one text makes it the person's own with no AI notes", async () => {
    const { records, card } = await setUp();

    const changed = await editCard({ records }, card.id, {
      type: "other",
      text: "Thank you for Sunday.",
    });

    expect(changed).toMatchObject({
      authorship: "user_owned",
      type: "other",
      sourceEntryIds: [],
    });
    expect(changed?.segments).toEqual([
      { id: "s1", category: "other", text: "Thank you for Sunday." },
    ]);
    expect(changed !== undefined && "sources" in changed).toBe(false);
  });

  it("picking an AI wording is a change like any other: the card becomes the person's own", async () => {
    const { records, card } = await setUp();

    const changed = await chooseAlternative(
      { records },
      card.id,
      "s2",
      "I felt close to you.",
    );

    expect(changed?.authorship).toBe("user_owned");
    expect(changed?.segments[1]).toEqual({
      id: "s2",
      category: "feeling",
      text: "I felt close to you.",
    });
    expect(changed?.segments[0]).toEqual(card.segments[0]);
  });

  it("moving a card in its collection is not a change to the card", async () => {
    const { records, card, collectionId } = await setUp();
    await createCard({ records }, collectionId, {
      type: "other",
      text: "Mine.",
    });

    await moveCard({ records }, collectionId, card.id, 2);

    expect(await records.get("conversation-card", card.id)).toEqual(card);
  });
});

describe("when a source entry changes (DEP-003, AC-12)", () => {
  it("keeps a user-owned card's wording but strips stale annotations (DEP-003, AC-12)", async () => {
    const { records, card, quoted } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });

    await editEntry({ records, events }, quoted.id, {
      responses: { ...quoted.responses, good: "changed" },
      feelings: [],
    });
    await invalidate(records, DEPENDENCY_RULES);

    const after = await records.get("conversation-card", card.id);
    expect(after?.authorship).toBe("user_owned");
    expect(after?.segments.map((segment) => segment.text)).toEqual([
      "I loved cooking with you.",
      "In my own words.",
    ]);
    expect(
      after?.segments.every(
        (segment) =>
          !("evidence" in segment) &&
          !("evidenceKind" in segment) &&
          !("teachingExplanation" in segment),
      ),
    ).toBe(true);
    expect(after?.sourceEntryIds).toEqual([]);
    expect(after !== undefined && "sources" in after).toBe(false);
  });

  it("strips them too when an entry that was sent but not quoted changes", async () => {
    const { records, card, sent } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });

    await editEntry({ records, events }, sent.id, {
      responses: { ...sent.responses, good: "changed" },
      feelings: [],
    });
    await invalidate(records, DEPENDENCY_RULES);

    const after = await records.get("conversation-card", card.id);
    expect(after !== undefined && hasAiNotes(after)).toBe(false);
    expect(after?.segments[0]?.text).toBe("I loved cooking with you.");
  });

  it("keeps the card, stripped, when the source entry is deleted", async () => {
    const { records, card, quoted } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });

    await deleteEntry({ records, events }, quoted.id);
    await invalidate(records, DEPENDENCY_RULES);

    const after = await records.get("conversation-card", card.id);
    expect(after?.segments).toEqual([
      { id: "s1", category: "appreciation", text: "I loved cooking with you." },
      { id: "s2", category: "feeling", text: "In my own words." },
    ]);
  });

  it("leaves no substring of the old source text in a preserved card (DEP-004)", async () => {
    const { records, card, quoted } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });
    await deleteEntry({ records, events }, quoted.id);
    await invalidate(records, DEPENDENCY_RULES);

    const stored = JSON.stringify(
      await records.get("conversation-card", card.id),
    );

    // Every run of five words of the old entry, and its ID and hash.
    const words = OLD_WORDS.split(" ");
    for (let at = 0; at + 5 <= words.length; at += 1) {
      expect(stored).not.toContain(words.slice(at, at + 5).join(" "));
    }
    expect(stored).not.toContain("CANARY");
    expect(stored).not.toContain(quoted.id);
    expect(stored).not.toContain(quoted.contentHash);
  });

  it("still deletes an AI card nobody has changed", async () => {
    const { records, card, quoted } = await setUp();

    await editEntry({ records, events }, quoted.id, {
      responses: { ...quoted.responses, good: "changed" },
      feelings: [],
    });
    const done = await invalidate(records, DEPENDENCY_RULES);

    expect(done).toEqual([{ kind: "conversation-card", id: card.id }]);
    expect(await records.get("conversation-card", card.id)).toBeUndefined();
  });

  it("never touches a card the person wrote", async () => {
    const { records, collectionId, quoted } = await setUp();
    const mine = await createCard({ records }, collectionId, {
      type: "other",
      text: "My own card.",
    });

    await deleteEntry({ records, events }, quoted.id);
    await invalidate(records, DEPENDENCY_RULES);

    expect(await records.get("conversation-card", mine?.id ?? "")).toEqual(
      mine,
    );
  });

  it("is settled after one pass: a second finds nothing to do", async () => {
    const { records, card, quoted } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });
    await deleteEntry({ records, events }, quoted.id);

    const first = await invalidate(records, DEPENDENCY_RULES);
    const stripped = await records.get("conversation-card", card.id);
    const second = await invalidate(records, DEPENDENCY_RULES);

    // Nothing was deleted either time: the card was kept, and changed once.
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(stripped !== undefined && hasAiNotes(stripped)).toBe(false);
    expect(await findStale(records, DEPENDENCY_RULES)).toEqual([]);
    expect(await records.get("conversation-card", card.id)).toEqual(stripped);
  });

  it("waits while the entry is changed in two places and not yet settled", async () => {
    const { records, card, quoted } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });
    const before = await records.get("conversation-card", card.id);
    await editEntry({ records, events }, quoted.id, {
      responses: { ...quoted.responses, good: "changed" },
      feelings: [],
    });
    records.park(quoted.id, quoted, 2, "journal-entry");

    expect(await invalidate(records, DEPENDENCY_RULES)).toEqual([]);
    expect(await records.get("conversation-card", card.id)).toEqual(before);
  });

  it("counts only cards that will be removed, not ones that will be kept", async () => {
    const { records, card, quoted } = await setUp();
    const index = async () => buildIndex(records, DEPENDENCY_RULES);
    expect((await index()).of(quoted.id).map((each) => each.action)).toEqual([
      "delete",
    ]);

    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });

    expect((await index()).of(quoted.id).map((each) => each.action)).toEqual([
      "strip",
    ]);
  });

  it("announces a removed card but not a kept one", async () => {
    const { records, card, quoted } = await setUp();
    await rewriteParts({ records }, card.id, {
      type: card.type,
      parts: parts(card, { s2: "In my own words." }),
    });
    const invalidator = new Invalidator(records, DEPENDENCY_RULES);
    invalidator.start();
    await invalidator.run();

    await deleteEntry({ records, events }, quoted.id);
    await invalidator.run();

    expect(invalidator.removed).toBe(0);
    expect(invalidator.removedCards).toBe(0);
    expect(
      (await records.get("conversation-card", card.id))?.segments,
    ).toHaveLength(2);
    invalidator.stop();
  });
});
