/**
 * Collections and cards across two devices: they sync like any private
 * record, and one changed in two places keeps both versions until the
 * person chooses (PRD SYNC-001, SYNC-004, SYNC-005, CC-010; AC-05, AC-13,
 * AC-16; invariant 5).
 */
import { describe, expect, it } from "vitest";

import {
  createCard,
  deleteCard,
  editCard,
} from "../../../src/domain/cards/cards";
import {
  createCollection,
  deleteCollection,
  keepStrayCards,
  moveCard,
  renameCollection,
} from "../../../src/domain/cards/collections";
import { RecordCardsStore } from "../../../src/domain/cards/store";
import { readingText } from "../../../src/domain/cards/types";
import { OUTBOX, RECORDS, type StoredRecord } from "../../../src/storage/db";
import {
  ConflictChangedError,
  RecordDeletedError,
} from "../../../src/storage/record-store";
import {
  KEPT_CARDS_NAME,
  chooseVersion,
  keepAsNew,
  listCardConflicts,
  type CardsConflict,
} from "../../../src/sync/card-conflicts";
import { ConflictGoneError, listConflicts } from "../../../src/sync/conflicts";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { readRows } from "../storage/idb-snapshot";
import { OWNER, device, entry, type Device } from "./devices";

function cardsOf(one: Device): RecordCardsStore {
  return new RecordCardsStore(one.store);
}

async function texts(one: Device, collectionId: string): Promise<string[]> {
  return (await cardsOf(one).cards(collectionId)).map(readingText);
}

async function names(one: Device): Promise<string[]> {
  return (await cardsOf(one).collections()).map((each) => each.name);
}

/** Two devices holding one synced collection with two cards. */
async function shared(): Promise<{
  server: MemoryServer;
  a: Device;
  b: Device;
  id: string;
  first: string;
  second: string;
}> {
  const server = new MemoryServer();
  const [a, b] = [await device(server), await device(server)];
  const made = await createCollection({ records: a.store }, "Sunday talk");
  const first = await createCard({ records: a.store }, made.id, {
    type: "appreciation",
    text: "Thank you for Thursday.",
  });
  const second = await createCard({ records: a.store }, made.id, {
    type: "curiosity",
    text: "How was your week?",
  });
  await a.sync();
  await b.sync();
  return {
    server,
    a,
    b,
    id: made.id,
    first: first?.id ?? "",
    second: second?.id ?? "",
  };
}

async function only(one: Device): Promise<CardsConflict> {
  const found = await listCardConflicts(one.store);
  expect(found).toHaveLength(1);
  return found[0] as CardsConflict;
}

describe("collections and cards sync between a person's devices (SYNC-001, AC-05)", () => {
  it("a collection and its cards made on one device appear on the other, in order", async () => {
    const { b, id } = await shared();

    expect(await names(b)).toEqual(["Sunday talk"]);
    expect(await texts(b, id)).toEqual([
      "Thank you for Thursday.",
      "How was your week?",
    ]);
  });

  // A collection's name and order are the same on the person's other device
  // (PRD AC-13).
  it("a rename, a reorder, an edit and a deletion made on one device reach the other", async () => {
    const { a, b, id, first, second } = await shared();

    await renameCollection({ records: b.store }, id, "Weekend talk");
    await moveCard({ records: b.store }, id, second, 1);
    await editCard({ records: b.store }, first, {
      type: "appreciation",
      text: "Thank you for Thursday and Friday.",
    });
    await b.sync();
    await a.sync();

    expect(await names(a)).toEqual(["Weekend talk"]);
    expect(await texts(a, id)).toEqual([
      "How was your week?",
      "Thank you for Thursday and Friday.",
    ]);

    await deleteCard({ records: a.store }, second);
    await a.sync();
    await b.sync();

    expect(await texts(b, id)).toEqual(["Thank you for Thursday and Friday."]);
    expect(await listCardConflicts(a.store)).toEqual([]);
    expect(await listCardConflicts(b.store)).toEqual([]);
  });

  it("deleting a collection deletes it and every card on the other device too, for good", async () => {
    const { server, a, b, id, first } = await shared();

    expect(await deleteCollection({ records: a.store }, id)).toBe(2);
    await a.sync();
    await b.sync();

    expect(await names(b)).toEqual([]);
    expect(await b.store.list("conversation-card")).toEqual([]);
    // A device that was away cannot bring a card back.
    const late = await device(server);
    await late.sync();
    expect(await late.store.list("conversation-card")).toEqual([]);
    await expect(
      b.store.put("conversation-card", {
        id: first,
        collectionId: id,
        type: "other",
        authorship: "user_owned",
        segments: [],
        sourceEntryIds: [],
        createdAt: "2026-11-01T09:00:00.000Z",
        updatedAt: "2026-11-01T09:00:00.000Z",
      }),
    ).rejects.toThrow(RecordDeletedError);
  });

  // A collection is private: its name and cards leave only as ciphertext
  // (PRD AC-13).
  it("stores names and card text only as ciphertext, and sends only ciphertext", async () => {
    const { server, a } = await shared();
    await createCard(
      { records: a.store },
      (await cardsOf(a).collections())[0]?.id ?? "",
      {
        type: "other",
        text: "CANARY card words",
      },
    );
    await renameCollection(
      { records: a.store },
      (await cardsOf(a).collections())[0]?.id ?? "",
      "CANARY name",
    );
    await a.sync();

    const stored = JSON.stringify([
      await readRows(a.name, RECORDS),
      await readRows(a.name, OUTBOX),
    ]);
    expect(stored).not.toContain("CANARY");
    expect(stored).not.toContain("Thank you");
    // What the server was sent, as text.
    const held = server
      .pull(OWNER, "0")
      .changes.map((change) =>
        new TextDecoder().decode(change.payload ?? new Uint8Array()),
      )
      .join("");
    expect(held).not.toContain("CANARY");
    expect(held).not.toContain("Thank you");
  });

  it("keeps each kind of record under its own type number", async () => {
    const { a } = await shared();
    await a.store.put("journal-entry", await entry());

    const types = (await readRows<StoredRecord>(a.name, RECORDS))
      .map((row) => row.type)
      .sort();

    expect(types).toEqual([1, 2, 3, 3]);
  });

  it("cards written on two devices at once are both kept, whichever list wins", async () => {
    const { a, b, id } = await shared();

    await createCard({ records: a.store }, id, {
      type: "other",
      text: "From A.",
    });
    await createCard({ records: b.store }, id, {
      type: "other",
      text: "From B.",
    });
    await a.sync();
    await b.sync();

    // Both cards exist on B straight away; the collection's list waits
    // for a choice.
    expect(await texts(b, id)).toEqual(
      expect.arrayContaining(["From A.", "From B."]),
    );
    const conflict = await only(b);
    expect(conflict).toMatchObject({
      record: "card-collection",
      kind: "edited",
    });

    // Keeping the other device's list still shows this device's card.
    await chooseVersion(b.store, conflict, "theirs");
    await b.sync();
    await a.sync();

    expect(await texts(a, id)).toHaveLength(4);
    expect((await texts(b, id)).sort()).toEqual((await texts(a, id)).sort());
  });
});

describe("a card added while its collection is deleted on another device", () => {
  it("is not lost or hidden: both devices show it as a stray, and keeping it puts it in kept cards everywhere", async () => {
    const { a, b, id } = await shared();

    await deleteCollection({ records: a.store }, id);
    await createCard({ records: b.store }, id, {
      type: "other",
      text: "Written on B meanwhile.",
    });
    await a.sync();
    await b.sync();
    // B's change to the deleted collection's list is refused and waits for
    // a choice; the card itself is a new record and is accepted.
    const waiting = await listCardConflicts(b.store);
    expect(waiting.map((each) => [each.record, each.kind])).toEqual([
      ["card-collection", "deleted-elsewhere"],
    ]);
    await chooseVersion(b.store, waiting[0] as CardsConflict, "theirs");
    await b.sync();
    await a.sync();

    for (const one of [a, b]) {
      expect((await cardsOf(one).strays()).map(readingText)).toEqual([
        "Written on B meanwhile.",
      ]);
      expect(await names(one)).toEqual([]);
    }

    const shown = (await cardsOf(a).strays()).map((each) => each.id);
    expect(await keepStrayCards({ records: a.store }, shown)).toBe(1);
    await a.sync();
    await b.sync();

    for (const one of [a, b]) {
      expect(await cardsOf(one).strays()).toEqual([]);
      expect(await names(one)).toEqual([KEPT_CARDS_NAME]);
      const kept = (await cardsOf(one).collections())[0]?.id ?? "";
      expect(await texts(one, kept)).toEqual(["Written on B meanwhile."]);
    }
  });
});

describe("a collection or card changed in two places (SYNC-004, SYNC-005, AC-16)", () => {
  /** Both devices change the same card; `b` syncs second and holds both. */
  async function cardClash() {
    const made = await shared();
    await editCard({ records: made.a.store }, made.first, {
      type: "appreciation",
      text: "From A.",
    });
    await editCard({ records: made.b.store }, made.first, {
      type: "appreciation",
      text: "From B.",
    });
    await made.a.sync();
    await made.b.sync();
    return made;
  }

  it("keeps both versions of a card until the person chooses, and is not a journal conflict", async () => {
    const { a, b, id } = await cardClash();

    const conflict = await only(b);

    expect(conflict).toMatchObject({
      record: "conversation-card",
      kind: "edited",
    });
    expect(
      conflict.mine === undefined ? "" : readingText(conflict.mine as never),
    ).toBe("From B.");
    expect(await texts(b, id)).toContain("From B.");
    expect(await texts(a, id)).toContain("From A.");
    expect(await listConflicts(b.store)).toEqual([]);
    expect(await listCardConflicts(a.store)).toEqual([]);
    expect(b.engine.state().status).toBe("attention");
  });

  it("keeping this device's version sends it on top of the other, and both devices agree", async () => {
    const { a, b, id } = await cardClash();

    await chooseVersion(b.store, await only(b), "mine");
    await b.sync();
    await a.sync();

    expect(await texts(a, id)).toContain("From B.");
    expect(await texts(a, id)).not.toContain("From A.");
    expect(await texts(b, id)).toEqual(await texts(a, id));
    expect(await listCardConflicts(b.store)).toEqual([]);
    expect(b.engine.state().status).toBe("synced");
  });

  it("keeping the other version replaces this device's and sends nothing", async () => {
    const { a, b, id } = await cardClash();

    await chooseVersion(b.store, await only(b), "theirs");

    expect(await texts(b, id)).toContain("From A.");
    expect(await texts(b, id)).not.toContain("From B.");
    expect(await readRows(b.name, OUTBOX)).toEqual([]);
    await b.sync();
    await a.sync();
    expect(await texts(a, id)).toEqual(await texts(b, id));
  });

  it("a collection renamed on two devices is settled the same way", async () => {
    const { a, b, id } = await shared();
    await renameCollection({ records: a.store }, id, "Name from A");
    await renameCollection({ records: b.store }, id, "Name from B");
    await a.sync();
    await b.sync();

    const conflict = await only(b);
    expect(conflict).toMatchObject({
      record: "card-collection",
      kind: "edited",
    });
    expect(await names(b)).toEqual(["Name from B"]);

    await chooseVersion(b.store, conflict, "theirs");

    expect(await names(b)).toEqual(["Name from A"]);
    expect(await texts(b, id)).toHaveLength(2);
  });

  it("a choice made twice, or for something already settled, changes nothing", async () => {
    const { b } = await cardClash();
    const conflict = await only(b);
    await chooseVersion(b.store, conflict, "theirs");

    await expect(chooseVersion(b.store, conflict, "mine")).rejects.toThrow(
      ConflictGoneError,
    );
    await expect(keepAsNew(b.store, conflict)).rejects.toThrow(
      ConflictGoneError,
    );
  });

  it("does not act on a version the person has not seen", async () => {
    const { a, b, first, id } = await cardClash();
    const seen = await only(b);
    // The other device changes the card again before the choice is made.
    await editCard({ records: a.store }, first, {
      type: "appreciation",
      text: "From A, again.",
    });
    await a.sync();
    await b.sync();

    await expect(chooseVersion(b.store, seen, "theirs")).rejects.toThrow(
      ConflictChangedError,
    );

    expect(await texts(b, id)).toContain("From B.");
    const newer = await only(b);
    expect(
      newer.theirs === undefined ? "" : readingText(newer.theirs as never),
    ).toBe("From A, again.");
  });

  describe("changed here, deleted on the other device", () => {
    async function cardDeletedThere() {
      const made = await shared();
      await deleteCard({ records: made.a.store }, made.first);
      await editCard({ records: made.b.store }, made.first, {
        type: "appreciation",
        text: "Changed on B.",
      });
      await made.a.sync();
      await made.b.sync();
      return made;
    }

    it("is not brought back by keeping this device's version", async () => {
      const { b, id } = await cardDeletedThere();
      const conflict = await only(b);

      expect(conflict.kind).toBe("deleted-elsewhere");
      await expect(chooseVersion(b.store, conflict, "mine")).rejects.toThrow(
        RecordDeletedError,
      );
      expect(await texts(b, id)).toContain("Changed on B.");
    });

    it("can be let go: deleted here too", async () => {
      const { a, b, id } = await cardDeletedThere();

      await chooseVersion(b.store, await only(b), "theirs");
      await b.sync();
      await a.sync();

      expect(await texts(b, id)).toEqual(["How was your week?"]);
      expect(await texts(a, id)).toEqual(["How was your week?"]);
    });

    it("can be kept as a new card in the same collection, and the old one stays deleted", async () => {
      const { a, b, id, first } = await cardDeletedThere();

      await keepAsNew(b.store, await only(b));
      await b.sync();
      await a.sync();

      expect(await texts(a, id)).toEqual([
        "How was your week?",
        "Changed on B.",
      ]);
      expect(await texts(b, id)).toEqual(await texts(a, id));
      expect(await b.store.get("conversation-card", first)).toBeUndefined();
      expect(await listCardConflicts(b.store)).toEqual([]);
    });

    it("a card whose whole collection was deleted is kept in a collection of kept cards", async () => {
      const { a, b, id, first, second } = await shared();
      await deleteCollection({ records: a.store }, id);
      await editCard({ records: b.store }, first, {
        type: "appreciation",
        text: "Changed on B.",
      });
      await editCard({ records: b.store }, second, {
        type: "curiosity",
        text: "Also changed on B.",
      });
      await a.sync();
      await b.sync();
      const waiting = await listCardConflicts(b.store);
      expect(waiting.map((each) => each.kind)).toEqual([
        "deleted-elsewhere",
        "deleted-elsewhere",
      ]);
      expect(await names(b)).toEqual([]);

      for (const conflict of waiting) {
        await keepAsNew(b.store, conflict);
      }
      await b.sync();
      await a.sync();

      // One collection of kept cards, used for both.
      expect(await names(a)).toEqual([KEPT_CARDS_NAME]);
      const kept = (await cardsOf(a).collections())[0]?.id ?? "";
      expect((await texts(a, kept)).sort()).toEqual([
        "Also changed on B.",
        "Changed on B.",
      ]);
    });

    it("a renamed collection deleted elsewhere can be kept as a new, empty one", async () => {
      const { a, b, id } = await shared();
      await deleteCollection({ records: a.store }, id);
      await renameCollection({ records: b.store }, id, "Still wanted");
      await a.sync();
      await b.sync();
      const conflict = await only(b);
      expect(conflict).toMatchObject({
        record: "card-collection",
        kind: "deleted-elsewhere",
      });

      await keepAsNew(b.store, conflict);
      await b.sync();
      await a.sync();

      expect(await names(a)).toEqual(["Still wanted"]);
      const kept = (await cardsOf(a).collections())[0];
      expect(kept?.id).not.toBe(id);
      expect(await texts(a, kept?.id ?? "")).toEqual([]);
    });

    it("if settling fails, the copy is removed again so the words are not there twice", async () => {
      const { b, id, first } = await cardDeletedThere();
      const seen = await only(b);
      // As if the other version had changed again since it was shown.
      const stale = { ...seen, revision: seen.revision + 5 };

      await expect(keepAsNew(b.store, stale)).rejects.toThrow(
        ConflictChangedError,
      );

      expect((await texts(b, id)).sort()).toEqual([
        "Changed on B.",
        "How was your week?",
      ]);
      // No copy was left behind, and the choice is still open.
      expect(await b.store.list("conversation-card")).toHaveLength(2);
      expect(await b.store.get("conversation-card", first)).toBeDefined();
      expect(await listCardConflicts(b.store)).toHaveLength(1);
    });
  });

  describe("deleted here, changed on the other device", () => {
    async function cardDeletedHere() {
      const made = await shared();
      await editCard({ records: made.a.store }, made.first, {
        type: "appreciation",
        text: "Changed on A.",
      });
      await deleteCard({ records: made.b.store }, made.first);
      await made.a.sync();
      await made.b.sync();
      return made;
    }

    it("shows the other device's version and can delete it everywhere", async () => {
      const { a, b, id } = await cardDeletedHere();
      const conflict = await only(b);
      expect(conflict.kind).toBe("deleted-here");
      expect(conflict.mine).toBeUndefined();

      await chooseVersion(b.store, conflict, "mine");
      await b.sync();
      await a.sync();

      expect(await texts(a, id)).toEqual(["How was your week?"]);
      expect(await texts(b, id)).toEqual(["How was your week?"]);
    });

    it("can take the deletion back and keep the other device's version", async () => {
      const { a, b, id } = await cardDeletedHere();

      await chooseVersion(b.store, await only(b), "theirs");
      await b.sync();
      await a.sync();

      expect(await texts(b, id)).toContain("Changed on A.");
      expect((await texts(a, id)).sort()).toEqual((await texts(b, id)).sort());
    });
  });
});
