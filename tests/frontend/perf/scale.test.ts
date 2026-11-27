/**
 * Opening a long journal does a bounded amount of work (PRD §8).
 *
 * The target a person feels is time: unlock to the list of entries in
 * about two seconds with 2,000 entries on a mid-range phone. A stopwatch
 * in a test on a shared machine would pass and fail with the weather, so
 * what is enforced here is what that time is made of, which does not vary:
 * each entry is decrypted once to open the journal and never again while
 * it is unlocked, searching decrypts nothing, and putting the entries in
 * order does not grow faster than the journal. The time itself is on the
 * manual list in `docs/support/browsers.md`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { importRootKey } from "../../../src/crypto/root-key";
import { newEntry, type JournalEntry } from "../../../src/domain/journal/types";
import { SearchIndex } from "../../../src/domain/search";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import { inTimelineOrder } from "../../../src/ui/screens/journal/shared";

const OWNER = "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90";
const ENTRIES = 2000;

afterEach(() => {
  vi.restoreAllMocks();
});

async function unlocked(name: string): Promise<EncryptedRecordStore> {
  const store = new EncryptedRecordStore(() => name);
  store.unlock(
    await importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i)),
    OWNER,
  );
  return store;
}

async function entry(day: number): Promise<JournalEntry> {
  const made = await newEntry(
    {
      good: `Day ${String(day)}: a walk by the river.`,
      improve: "Listen more.",
      loved: "A note in my bag.",
    },
    new Date(Date.UTC(2020, 0, 1 + day, 10)),
  );
  return { ...made, status: "complete" };
}

describe(`a journal of ${String(ENTRIES)} entries`, () => {
  it("is opened by decrypting each entry once, and read again without decrypting any", async () => {
    const writer = await unlocked("scale-test");
    for (let day = 0; day < ENTRIES; day += 1) {
      await writer.put("journal-entry", await entry(day));
    }
    writer.lock();

    // As after a restart: the same database, opened afresh.
    const reader = await unlocked("scale-test");
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");

    const first = await reader.list("journal-entry");

    expect(first).toHaveLength(ENTRIES);
    expect(decrypt).toHaveBeenCalledTimes(ENTRIES);

    const again = await reader.list("journal-entry");
    await reader.get("journal-entry", first[0]?.id ?? "");

    expect(again).toHaveLength(ENTRIES);
    expect(decrypt).toHaveBeenCalledTimes(ENTRIES);
  }, 120_000);

  it("is put in order, indexed and searched without touching storage or keys", async () => {
    const entries = await Promise.all(
      Array.from({ length: ENTRIES }, (_, day) => entry(day)),
    );
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    const compare = vi.spyOn(String.prototype, "localeCompare");

    const ordered = inTimelineOrder(entries);
    const comparisons = compare.mock.calls.length;
    const index = new SearchIndex();
    for (const each of ordered) {
      index.add({ id: each.id, fields: Object.values(each.responses) });
    }
    const found = index.search("river day 1999");

    expect(ordered[0]?.responses.good).toBe("Day 1999: a walk by the river.");
    expect(found).toHaveLength(1);
    expect(decrypt).not.toHaveBeenCalled();
    // Sorting n entries takes about n log n comparisons, each of which may
    // look at the day, the time and the ID. Far below n squared.
    expect(comparisons).toBeLessThan(ENTRIES * 100);
  });
});
