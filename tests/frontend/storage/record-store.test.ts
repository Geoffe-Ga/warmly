import { describe, expect, it } from "vitest";

import { newEntry } from "../../../src/domain/journal/types";
import { MemoryRecordStore } from "../../../src/storage/record-store";
import { seedJournal } from "../../../src/testing/seed-journal";

const SEED_JOURNAL = seedJournal();

const ANSWERS = { good: "a", improve: "b", loved: "c" };

describe("the in-memory record store (SYNC-001)", () => {
  it("starts empty, and returns what was put by kind and ID", async () => {
    const store = new MemoryRecordStore();
    const entry = await newEntry(ANSWERS);
    expect(await store.list("journal-entry")).toEqual([]);
    expect(await store.get("journal-entry", entry.id)).toBeUndefined();

    await store.put("journal-entry", entry);

    expect(await store.get("journal-entry", entry.id)).toEqual(entry);
    expect(await store.list("journal-entry")).toEqual([entry]);
  });

  it("replaces a record that has the same ID", async () => {
    const store = new MemoryRecordStore();
    const entry = await newEntry(ANSWERS);
    await store.put("journal-entry", entry);

    await store.put("journal-entry", { ...entry, status: "draft" });

    expect(await store.list("journal-entry")).toHaveLength(1);
    expect((await store.get("journal-entry", entry.id))?.status).toBe("draft");
  });

  it("deletes a record, and ignores one that is not there", async () => {
    const store = new MemoryRecordStore();
    const entry = await newEntry(ANSWERS);
    await store.put("journal-entry", entry);

    await store.delete("journal-entry", entry.id);
    await store.delete("journal-entry", "unknown");

    expect(await store.list("journal-entry")).toEqual([]);
  });

  it("tells subscribers after each change, until they unsubscribe", async () => {
    const store = new MemoryRecordStore();
    const entry = await newEntry(ANSWERS);
    let changes = 0;
    const unsubscribe = store.subscribe(() => {
      changes += 1;
    });

    await store.put("journal-entry", entry);
    await store.delete("journal-entry", "unknown");
    await store.delete("journal-entry", entry.id);
    store.lock();
    expect(changes).toBe(3);

    unsubscribe();
    await store.put("journal-entry", entry);
    expect(changes).toBe(3);
  });

  it("drops everything that was written when it locks (DEV-005)", async () => {
    const store = new MemoryRecordStore();
    await store.put("journal-entry", await newEntry(ANSWERS));

    store.lock();

    expect(await store.list("journal-entry")).toEqual([]);
  });

  it("returns to its synthetic examples, and only those, when it locks", async () => {
    const store = new MemoryRecordStore(SEED_JOURNAL);
    const written = await newEntry(ANSWERS);
    await store.put("journal-entry", written);
    await store.delete("journal-entry", SEED_JOURNAL[0]?.id ?? "");

    store.lock();

    expect(await store.list("journal-entry")).toEqual([...SEED_JOURNAL]);
    expect(await store.get("journal-entry", written.id)).toBeUndefined();
  });
});

describe("the example entries", () => {
  it("say in every answer that they are examples", () => {
    expect(SEED_JOURNAL.length).toBeGreaterThan(0);
    for (const entry of SEED_JOURNAL) {
      for (const answer of Object.values(entry.responses)) {
        expect(answer).toMatch(/^Example entry: /);
      }
      expect(entry.status).toBe("complete");
    }
    expect(new Set(SEED_JOURNAL.map((entry) => entry.id)).size).toBe(
      SEED_JOURNAL.length,
    );
  });
});
