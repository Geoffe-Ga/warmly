import { describe, expect, it } from "vitest";

import { newEntry } from "../../../src/domain/journal/types";
import {
  MemoryRecordStore,
  type RecordStore,
} from "../../../src/storage/record-store";

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

  it("knows which records were deleted, by kind, and not ones that were never here", async () => {
    const store = new MemoryRecordStore();
    const entry = await newEntry(ANSWERS);
    await store.put("journal-entry", entry);
    expect(await store.deleted("journal-entry")).toEqual([]);

    await store.delete("journal-entry", entry.id);
    await store.delete("journal-entry", "never-here");

    expect(await store.deleted("journal-entry")).toEqual([entry.id]);
    expect(await store.deleted("reflect-session")).toEqual([]);
    // A deletion accepted from another device counts too.
    const other = await newEntry(ANSWERS);
    await store.put("journal-entry", other);
    store.park(other.id, undefined, 2);
    expect(await store.deleted("journal-entry")).toEqual([entry.id]);
    await store.resolve("journal-entry", other.id, "theirs", 2);
    expect((await store.deleted("journal-entry")).sort()).toEqual(
      [entry.id, other.id].sort(),
    );

    store.lock();
    expect(await store.deleted("journal-entry")).toEqual([]);
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

  it("reads a record again as it is in memory", async () => {
    const store: RecordStore = new MemoryRecordStore();
    const entry = await newEntry(ANSWERS);
    await store.put("journal-entry", entry);

    expect(await store.reload("journal-entry", entry.id)).toEqual(entry);
    expect(await store.reload("journal-entry", "never-there")).toBeUndefined();
  });

  it("has no record it cannot read", async () => {
    const store: RecordStore = new MemoryRecordStore();

    expect(await store.unreadable("journal-entry")).toBe(0);
  });
});
