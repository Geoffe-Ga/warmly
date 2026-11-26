import { describe, expect, it } from "vitest";

import { createEventBus, type DomainEvents } from "../../../src/domain/events";
import { contentHash } from "../../../src/domain/journal/content-hash";
import { completedFrom, draftFrom } from "../../../src/domain/journal/drafts";
import {
  EntryNotFoundError,
  IncompleteEntryError,
  editEntry,
} from "../../../src/domain/journal/edit";
import type { JournalEntry } from "../../../src/domain/journal/types";
import { importRootKey } from "../../../src/crypto/root-key";
import { OUTBOX, RECORDS } from "../../../src/storage/db";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import {
  MemoryRecordStore,
  StaleRecordError,
} from "../../../src/storage/record-store";
import { readRows } from "../storage/idb-snapshot";

const WRITTEN = new Date("2026-11-03T09:00:00Z");
const EDITED = new Date("2026-11-20T18:30:00Z");
const ORIGINAL = {
  responses: {
    good: "CANARY-OLD the first wording",
    improve: "Planning weekends.",
    loved: "A note on the fridge.",
  },
  feelings: ["calm"] as const,
};

async function setUp(): Promise<{
  records: MemoryRecordStore;
  events: ReturnType<typeof createEventBus>;
  heard: DomainEvents["journal.changed"][];
  entry: JournalEntry;
}> {
  const records = new MemoryRecordStore();
  const events = createEventBus();
  const heard: DomainEvents["journal.changed"][] = [];
  events.on("journal.changed", (event) => {
    heard.push(event);
  });
  const entry = await completedFrom(ORIGINAL, undefined, WRITTEN);
  await records.put("journal-entry", entry);
  return { records, events, heard, entry };
}

describe("editing an entry in place (JR-006, AC-06)", () => {
  it("preserves the ID, creation time and day, and recomputes the change time and hash", async () => {
    const { records, events, entry } = await setUp();
    const rewritten = {
      responses: { ...ORIGINAL.responses, good: "rewritten" },
      feelings: ORIGINAL.feelings,
    };

    const edited = await editEntry({ records, events }, entry.id, rewritten, {
      now: EDITED,
    });

    expect(edited).toEqual({
      ...entry,
      updatedAt: "2026-11-20T18:30:00.000Z",
      responses: rewritten.responses,
      contentHash: await contentHash(rewritten.responses),
    });
    expect(edited.createdAt).toBe("2026-11-03T09:00:00.000Z");
    expect(await records.get("journal-entry", entry.id)).toEqual(edited);
    expect(await records.list("journal-entry")).toHaveLength(1);
  });

  it("announces journal.changed with the old and new hashes when the text changes", async () => {
    const { records, events, heard, entry } = await setUp();

    const edited = await editEntry({ records, events }, entry.id, {
      responses: { ...ORIGINAL.responses, good: "rewritten" },
      feelings: ORIGINAL.feelings,
    });

    expect(heard).toEqual([
      {
        entryId: entry.id,
        oldHash: entry.contentHash,
        newHash: edited.contentHash,
      },
    ]);
    expect(edited.contentHash).not.toBe(entry.contentHash);
  });

  it("announces only after the entry is stored", async () => {
    const { records, events, entry } = await setUp();
    let storedWhenHeard: string | undefined;
    events.on("journal.changed", async () => {
      storedWhenHeard = (await records.get("journal-entry", entry.id))
        ?.responses.good;
    });

    await editEntry({ records, events }, entry.id, {
      responses: { ...ORIGINAL.responses, good: "rewritten" },
      feelings: [],
    });

    expect(storedWhenHeard).toBe("rewritten");
  });

  it("stores a change of feelings but announces nothing, because the hash does not cover them (D-24)", async () => {
    const { records, events, heard, entry } = await setUp();

    const edited = await editEntry(
      { records, events },
      entry.id,
      { responses: ORIGINAL.responses, feelings: ["sad", "calm"] },
      { now: EDITED },
    );

    expect(heard).toEqual([]);
    expect(edited.feelings).toEqual(["calm", "sad"]);
    expect(edited.contentHash).toBe(entry.contentHash);
    expect(edited.updatedAt).toBe("2026-11-20T18:30:00.000Z");
    expect((await records.get("journal-entry", entry.id))?.feelings).toEqual([
      "calm",
      "sad",
    ]);
  });

  it("removes the feelings when none are chosen any more", async () => {
    const { records, events, entry } = await setUp();

    const edited = await editEntry({ records, events }, entry.id, {
      responses: ORIGINAL.responses,
      feelings: [],
    });

    expect("feelings" in edited).toBe(false);
  });

  it("writes and announces nothing when nothing changed", async () => {
    const { records, events, heard, entry } = await setUp();
    let writes = 0;
    records.subscribe(() => {
      writes += 1;
    });

    const same = await editEntry(
      { records, events },
      entry.id,
      { responses: { ...ORIGINAL.responses }, feelings: ["calm"] },
      { now: EDITED },
    );

    expect(same).toBe(entry);
    expect(writes).toBe(0);
    expect(heard).toEqual([]);
  });

  it.each(["", "   ", "\n\t"])(
    "refuses an edit that would leave an answer as %j, and changes nothing (JR-002)",
    async (blank) => {
      const { records, events, heard, entry } = await setUp();

      await expect(
        editEntry({ records, events }, entry.id, {
          responses: { ...ORIGINAL.responses, loved: blank },
          feelings: [],
        }),
      ).rejects.toThrow(IncompleteEntryError);

      expect(await records.get("journal-entry", entry.id)).toEqual(entry);
      expect(heard).toEqual([]);
    },
  );

  it("refuses an ID with no entry, and a draft, which is changed on the compose screen", async () => {
    const { records, events, heard } = await setUp();
    const draft = await draftFrom({
      responses: { good: "half", improve: "", loved: "" },
      feelings: [],
    });
    await records.put("journal-entry", draft);
    const full = { responses: ORIGINAL.responses, feelings: [] };

    await expect(
      editEntry({ records, events }, "no-such-entry", full),
    ).rejects.toThrow(EntryNotFoundError);
    await expect(
      editEntry({ records, events }, draft.id, full),
    ).rejects.toThrow(EntryNotFoundError);

    expect(await records.get("journal-entry", draft.id)).toEqual(draft);
    expect(heard).toEqual([]);
  });

  it("announces nothing when the entry could not be stored", async () => {
    const { records, events, heard, entry } = await setUp();
    records.put = () => Promise.reject(new Error("synthetic"));

    await expect(
      editEntry({ records, events }, entry.id, {
        responses: { ...ORIGINAL.responses, good: "rewritten" },
        feelings: [],
      }),
    ).rejects.toThrow("synthetic");

    expect(heard).toEqual([]);
  });

  it("succeeds once the entry is stored, even when a listener fails", async () => {
    const { records, events, heard, entry } = await setUp();
    events.on("journal.changed", () => {
      throw new Error("synthetic listener failure");
    });
    const rewritten = {
      responses: { ...ORIGINAL.responses, good: "rewritten" },
      feelings: ORIGINAL.feelings,
    };

    const edited = await editEntry({ records, events }, entry.id, rewritten);

    expect(edited.responses.good).toBe("rewritten");
    expect(await records.get("journal-entry", entry.id)).toEqual(edited);
    // The other listener still heard it.
    expect(heard).toHaveLength(1);
  });

  it("keeps no trace of the old text: not in memory, and not in IndexedDB", async () => {
    const name = `edit-test-${crypto.randomUUID()}`;
    const store = new EncryptedRecordStore(() => name);
    store.unlock(
      await importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i)),
      "owner-1",
    );
    const events = createEventBus();
    const entry = await completedFrom(ORIGINAL, undefined, WRITTEN);
    await store.put("journal-entry", entry);

    const edited = await editEntry({ records: store, events }, entry.id, {
      responses: { ...ORIGINAL.responses, good: "rewritten" },
      feelings: [],
    });

    // Memory holds one entry, with the new text only.
    expect(JSON.stringify(await store.list("journal-entry"))).not.toContain(
      "CANARY-OLD",
    );
    expect(await store.list("journal-entry")).toEqual([edited]);
    // IndexedDB holds one row for the entry: the old ciphertext was
    // replaced, not kept beside the new one.
    const rows = await readRows<{ id: string; localRevision: number }>(
      name,
      RECORDS,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: entry.id, localRevision: 2 });
    for (const storeName of [RECORDS, OUTBOX]) {
      const text = JSON.stringify(
        await readRows(name, storeName),
        (_key, value: unknown) =>
          ArrayBuffer.isView(value)
            ? new TextDecoder("latin1").decode(value as Uint8Array)
            : value,
      );
      expect(text).not.toContain("CANARY-OLD");
    }
    // Reading it back after a lock gives the new text.
    store.lock();
    store.unlock(
      await importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i)),
      "owner-1",
    );
    expect(await store.get("journal-entry", entry.id)).toEqual(edited);
  });

  it("refuses to save over an entry that is no longer what the form was filled from (invariant 5)", async () => {
    const { records, events, heard, entry } = await setUp();
    // The entry changes under the form: sync brought another device's edit.
    const newer = await editEntry({ records, events }, entry.id, {
      responses: { ...ORIGINAL.responses, good: "from another device" },
      feelings: ORIGINAL.feelings,
    });
    heard.length = 0;

    await expect(
      editEntry(
        { records, events },
        entry.id,
        {
          responses: { ...ORIGINAL.responses, good: "typed here" },
          feelings: ORIGINAL.feelings,
        },
        { seen: ORIGINAL },
      ),
    ).rejects.toThrow(StaleRecordError);

    expect(await records.get("journal-entry", entry.id)).toEqual(newer);
    expect(heard).toEqual([]);
  });

  it("counts a change of feelings alone as a change under the form", async () => {
    const { records, events, entry } = await setUp();
    await editEntry({ records, events }, entry.id, {
      responses: ORIGINAL.responses,
      feelings: ["sad"],
    });

    await expect(
      editEntry(
        { records, events },
        entry.id,
        {
          responses: { ...ORIGINAL.responses, good: "typed here" },
          feelings: ORIGINAL.feelings,
        },
        { seen: ORIGINAL },
      ),
    ).rejects.toThrow(StaleRecordError);
  });

  it("saves when the entry is still what the form was filled from", async () => {
    const { records, events, entry } = await setUp();

    const edited = await editEntry(
      { records, events },
      entry.id,
      {
        responses: { ...ORIGINAL.responses, good: "typed here" },
        feelings: ORIGINAL.feelings,
      },
      { seen: ORIGINAL },
    );

    expect(edited.responses.good).toBe("typed here");
  });
});
