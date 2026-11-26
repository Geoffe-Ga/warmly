/**
 * A write names the copy it was made to, and the store compares it as part
 * of the write (ADR-0016; PRD invariant 5, SYNC-001).
 *
 * The cases here are the ones a check made before the write cannot catch:
 * the record changes after the caller has read it, by sync or by a write
 * that lands while the caller is still preparing its own.
 */
import { describe, expect, it } from "vitest";

import { createEventBus } from "../../../src/domain/events";
import { completedFrom } from "../../../src/domain/journal/drafts";
import { editEntry } from "../../../src/domain/journal/edit";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  MemoryRecordStore,
  StaleRecordError,
  type RecordStore,
} from "../../../src/storage/record-store";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { device, entry } from "../sync/devices";

function reworded(saved: JournalEntry, good: string): Promise<JournalEntry> {
  return completedFrom(
    { responses: { ...saved.responses, good }, feelings: [] },
    saved,
  );
}

/** Two devices that both hold one entry, settled with the server. */
async function twoDevices() {
  const server = new MemoryServer();
  const a = await device(server);
  const b = await device(server);
  const saved = await entry();
  await a.store.put("journal-entry", saved);
  await a.sync();
  await b.sync();
  return { a, b, saved };
}

describe("a write based on a copy the store no longer holds", () => {
  it("is refused when sync replaced the copy after it was read", async () => {
    const { a, b, saved } = await twoDevices();
    // The second device reads the entry, as a screen does to show it.
    const read = await b.store.get("journal-entry", saved.id);
    expect(read).toBeDefined();
    // Meanwhile the first device changes it, and the change arrives.
    const theirs = await reworded(saved, "From the other device");
    await a.store.put("journal-entry", theirs);
    await a.sync();
    await b.sync();

    await expect(
      b.store.put("journal-entry", await reworded(saved, "Typed here"), read),
    ).rejects.toThrow(StaleRecordError);

    expect(await b.store.get("journal-entry", saved.id)).toEqual(theirs);
    // Nothing was queued to be sent, either.
    expect(await b.store.pending()).toEqual([]);
  });

  it("is accepted when the copy is still the one held, and the stored copy becomes the next base", async () => {
    const { b, saved } = await twoDevices();
    const read = await b.store.get("journal-entry", saved.id);
    const first = await reworded(saved, "Once");

    await b.store.put("journal-entry", first, read);
    // What was stored is now the copy to base the next change on.
    const second = await reworded(first, "Twice");
    await b.store.put("journal-entry", second, first);

    expect(await b.store.get("journal-entry", saved.id)).toEqual(second);
    // The copy read at the start is two changes old.
    await expect(
      b.store.put("journal-entry", await reworded(saved, "Late"), read),
    ).rejects.toThrow(StaleRecordError);
  });

  it("is still accepted after this device's own change has been sent and come back in the feed", async () => {
    const { b, saved } = await twoDevices();
    const read = await b.store.get("journal-entry", saved.id);
    const first = await reworded(saved, "Once");
    await b.store.put("journal-entry", first, read);
    // Sent, then met again in the change feed: not a change to the copy.
    await b.sync();
    await b.sync();

    await b.store.put("journal-entry", await reworded(first, "Twice"), first);

    expect((await b.store.get("journal-entry", saved.id))?.responses.good).toBe(
      "Twice",
    );
  });

  it("is refused in memory by the same rule", async () => {
    const records = new MemoryRecordStore();
    const saved = await entry();
    await records.put("journal-entry", saved);
    const theirs = await reworded(saved, "From elsewhere");
    await records.put("journal-entry", theirs);

    await expect(
      records.put("journal-entry", await reworded(saved, "Typed"), saved),
    ).rejects.toThrow(StaleRecordError);
    expect(await records.get("journal-entry", saved.id)).toBe(theirs);
  });
});

describe("a change that lands between an edit's read and its write", () => {
  /**
   * A store whose `get` is followed at once by another device's change,
   * so the change lands after the edit has read the entry and before it
   * writes. The edit has already made every check it makes for itself.
   */
  function withAChangeAfterEachRead(
    records: MemoryRecordStore,
    theirs: JournalEntry,
  ): RecordStore {
    const get = records.get.bind(records);
    records.get = (async (...args: Parameters<typeof get>) => {
      const found = await get(...args);
      await records.put("journal-entry", theirs);
      return found;
    }) as typeof get;
    return records;
  }

  it("is not written over: the edit is refused by the write itself", async () => {
    const records = new MemoryRecordStore();
    const saved = await entry();
    await records.put("journal-entry", saved);
    const theirs = await reworded(saved, "From the other device");
    const events = createEventBus();
    const heard: unknown[] = [];
    events.on("journal.changed", (event) => {
      heard.push(event);
    });

    await expect(
      editEntry(
        { records: withAChangeAfterEachRead(records, theirs), events },
        saved.id,
        { responses: { ...saved.responses, good: "Typed here" }, feelings: [] },
      ),
    ).rejects.toThrow(StaleRecordError);

    // The other device's version is what is stored, untouched.
    expect(await records.list("journal-entry")).toEqual([theirs]);
    expect(heard).toEqual([]);
  });
});
