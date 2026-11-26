/**
 * Two tabs of one account tell each other when a record changes, so a tab
 * shows what the other stored without being asked to reload (ADR-0017;
 * PRD SYNC-001, invariant 5).
 *
 * Each "tab" here is its own `EncryptedRecordStore` on the same database,
 * joined by an in-memory stand-in for `BroadcastChannel`. The message says
 * only "something changed": a tab reads what changed from the database.
 */
import { describe, expect, it } from "vitest";

import type { ReflectionAnswer } from "../../../src/ai/contracts";
import { importRootKey, type RootKey } from "../../../src/crypto/root-key";
import { DEPENDENCY_RULES } from "../../../src/domain/dependency-rules";
import { Invalidator } from "../../../src/domain/deps/invalidate";
import { RecordReflectSessions } from "../../../src/domain/reflect/sessions";
import { completedFrom } from "../../../src/domain/journal/drafts";
import { newEntry, type JournalEntry } from "../../../src/domain/journal/types";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import { StaleRecordError } from "../../../src/storage/record-store";
import { SyncEngine } from "../../../src/sync/engine";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import {
  holdsCurrent,
  type TabChannel,
} from "../../../src/storage/tab-channel";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const CANARY = "CANARY-tabs-private-text";
let databases = 0;

function rootKey(): Promise<RootKey> {
  return importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i));
}

function entry(good = "Synthetic answer"): Promise<JournalEntry> {
  return newEntry({ good, improve: "Synthetic two", loved: "Synthetic three" });
}

function reworded(saved: JournalEntry, good: string): Promise<JournalEntry> {
  return completedFrom(
    { responses: { ...saved.responses, good }, feelings: [] },
    saved,
  );
}

/** Every channel opened under one name hears what the others post. */
class Hub {
  readonly posted: unknown[] = [];
  readonly names: string[] = [];
  readonly #open = new Map<string, Set<(message: unknown) => void>>();
  #deliveries: Promise<void>[] = [];

  readonly channel = (name: string): TabChannel => {
    this.names.push(name);
    const listeners = this.#open.get(name) ?? new Set();
    this.#open.set(name, listeners);
    let mine: ((message: unknown) => void) | undefined;
    return {
      post: (message) => {
        this.posted.push(message);
        for (const listener of listeners) {
          if (listener !== mine) {
            // As a browser does: later, and never to the sender.
            this.#deliveries.push(
              Promise.resolve().then(() => {
                if (listeners.has(listener)) {
                  listener(message);
                }
              }),
            );
          }
        }
      },
      listen: (listener) => {
        mine = listener;
        listeners.add(listener);
      },
      close: () => {
        if (mine !== undefined) {
          listeners.delete(mine);
        }
      },
    };
  };

  /** Send a message as some other page on this origin could. */
  forge(name: string, message: unknown): void {
    for (const listener of this.#open.get(name) ?? []) {
      listener(message);
    }
  }

  /** How many channels are listening under a name. */
  listening(name: string): number {
    return this.#open.get(name)?.size ?? 0;
  }

  /** Wait until every message posted so far has been delivered. */
  async delivered(): Promise<void> {
    while (this.#deliveries.length > 0) {
      const waiting = this.#deliveries;
      this.#deliveries = [];
      await Promise.all(waiting);
    }
  }
}

async function tabs(hub = new Hub()) {
  databases += 1;
  const prefix = `tabs-test-${String(databases)}`;
  const names = (owner: string): string => `${prefix}-${owner}`;
  const root = await rootKey();
  const open = (): EncryptedRecordStore => {
    const store = new EncryptedRecordStore(names, hub.channel);
    store.unlock(root, OWNER);
    return store;
  };
  const a = open();
  const b = open();
  /** Wait until `store` has taken in everything the other tab announced. */
  const settled = async (store: EncryptedRecordStore): Promise<void> => {
    await hub.delivered();
    await store.caughtUp();
  };
  return { a, b, hub, settled, name: names(OWNER), open };
}

describe("a record stored in one tab", () => {
  it("appears in the other without a reload, and its listeners are told", async () => {
    const { a, b, settled } = await tabs();
    expect(await b.list("journal-entry")).toEqual([]);
    let told = 0;
    b.subscribe(() => {
      told += 1;
    });
    const saved = await entry();

    await a.put("journal-entry", saved);
    await settled(b);

    expect(await b.list("journal-entry")).toEqual([saved]);
    expect(told).toBeGreaterThan(0);
  });

  it("replaces the copy the other tab held when it is changed", async () => {
    const { a, b, settled } = await tabs();
    const saved = await entry();
    await a.put("journal-entry", saved);
    await settled(b);
    const changed = await reworded(saved, "Changed in the first tab");

    await a.put(
      "journal-entry",
      changed,
      await a.get("journal-entry", saved.id),
    );
    await settled(b);

    expect(await b.get("journal-entry", saved.id)).toEqual(changed);
  });

  it("is gone from the other tab once it is deleted, and listed there as deleted", async () => {
    const { a, b, settled } = await tabs();
    const saved = await entry();
    await a.put("journal-entry", saved);
    await settled(b);

    await a.delete("journal-entry", saved.id);
    await settled(b);

    expect(await b.get("journal-entry", saved.id)).toBeUndefined();
    expect(await b.list("journal-entry")).toEqual([]);
    expect(await b.deleted("journal-entry")).toEqual([saved.id]);
  });
});

describe("what the other tab was in the middle of", () => {
  it("keeps the very copy it held of a record that did not change", async () => {
    const { a, b, settled } = await tabs();
    const untouched = await entry("Left alone");
    const other = await entry("About to change");
    await a.put("journal-entry", untouched);
    await a.put("journal-entry", other);
    await settled(b);
    const held = await b.get("journal-entry", untouched.id);

    await a.put("journal-entry", await reworded(other, "Changed"));
    await settled(b);

    // The same object, so a change based on it is still accepted
    // (ADR-0016): another record's change must not refuse this one.
    expect(await b.get("journal-entry", untouched.id)).toBe(held);
    await b.put("journal-entry", await reworded(untouched, "Edited"), held);
  });

  it("refuses a change based on the copy the first tab has since replaced, and stores nothing", async () => {
    const { a, b, settled } = await tabs();
    const saved = await entry();
    await a.put("journal-entry", saved);
    await settled(b);
    const shown = await b.get("journal-entry", saved.id);
    const theirs = await reworded(saved, "From the first tab");
    await a.put("journal-entry", theirs);
    await settled(b);

    await expect(
      b.put("journal-entry", await reworded(saved, "Typed here"), shown),
    ).rejects.toThrow(StaleRecordError);

    expect(await b.get("journal-entry", saved.id)).toEqual(theirs);
    expect(await a.reload("journal-entry", saved.id)).toEqual(theirs);
  });

  it("does not undo a change of its own that it stored after the first tab's", async () => {
    const { a, b, settled } = await tabs();
    const first = await entry("First tab's entry");
    const second = await entry("Second tab's entry");

    // Both store before either has heard from the other.
    await Promise.all([
      a.put("journal-entry", first),
      b.put("journal-entry", second),
    ]);
    await settled(a);
    await settled(b);

    const ids = (list: JournalEntry[]) => list.map((each) => each.id).sort();
    expect(ids(await a.list("journal-entry"))).toEqual(
      [first.id, second.id].sort(),
    );
    expect(ids(await b.list("journal-entry"))).toEqual(
      [first.id, second.id].sort(),
    );
  });
});

describe("whether memory already holds a stored row", () => {
  const row = (localRevision: number, tombstone = false) => ({
    localRevision,
    tombstone,
  });

  it("does when it holds the row's revision", () => {
    expect(holdsCurrent({ revision: 2 }, false, row(2))).toBe(true);
  });

  it("does not when the row is newer, or is not held at all", () => {
    expect(holdsCurrent({ revision: 1 }, false, row(2))).toBe(false);
    expect(holdsCurrent(undefined, false, row(1))).toBe(false);
    expect(holdsCurrent(undefined, true, row(1))).toBe(false);
  });

  it("does when it holds a newer revision than the row that was read", () => {
    // This tab stored a change of its own after the rows were read. The
    // older row must not replace it.
    expect(holdsCurrent({ revision: 3 }, false, row(2))).toBe(true);
  });

  it("does for a deleted row only once nothing of it is held", () => {
    expect(holdsCurrent(undefined, false, row(2, true))).toBe(true);
    expect(holdsCurrent({ revision: 1 }, false, row(2, true))).toBe(false);
    expect(holdsCurrent(undefined, true, row(2, true))).toBe(false);
    // A deleted record never comes back, so a copy is dropped whatever
    // revision it claims.
    expect(holdsCurrent({ revision: 9 }, false, row(2, true))).toBe(false);
  });
});

describe("what was built from an entry, with two tabs open", () => {
  function answerFrom(source: JournalEntry): ReflectionAnswer {
    return {
      markdown: "Synthetic answer.",
      citations: [],
      sources: [{ entryId: source.id, sourceHash: source.contentHash }],
      coverage: {
        includedEntryIds: [source.id],
        omittedEntryCount: 0,
        truncated: false,
      },
    };
  }

  it("is removed in both when the entry changes in one, though both tabs try", async () => {
    const { a, b, hub } = await tabs();
    const checking = [a, b].map((store) => {
      const invalidator = new Invalidator(store, DEPENDENCY_RULES);
      invalidator.start();
      return invalidator;
    });
    /** Until neither tab has anything left to read or to check. */
    const quiet = async (): Promise<void> => {
      for (let round = 0; round < 6; round += 1) {
        await hub.delivered();
        await Promise.all([a.caughtUp(), b.caughtUp()]);
        await Promise.all(checking.map((each) => each.run()));
      }
    };
    const source = await entry();
    const untouched = await entry("Not changed");
    await a.put("journal-entry", source);
    await a.put("journal-entry", untouched);
    const sessions = new RecordReflectSessions(a);
    for (const question of ["One?", "Two?", "Three?"]) {
      await sessions.start({ question, answer: answerFrom(source) });
    }
    const kept = await sessions.start({
      question: "About the other entry?",
      answer: answerFrom(untouched),
    });
    await quiet();
    expect(await b.list("reflect-session")).toHaveLength(4);

    await a.put(
      "journal-entry",
      await reworded(source, "Changed in the first tab"),
      await a.get("journal-entry", source.id),
    );
    await quiet();

    // Every session built from the changed entry is gone in both tabs,
    // and the one built from the other entry is in both.
    for (const store of [a, b]) {
      expect(
        (await store.list("reflect-session")).map((each) => each.id),
      ).toEqual([kept.id]);
      expect(await store.deleted("reflect-session")).toHaveLength(3);
      expect(await store.list("journal-entry")).toHaveLength(2);
    }
    for (const each of checking) {
      each.stop();
    }
  });
});

describe("what sync does in one tab", () => {
  function syncing(store: EncryptedRecordStore, server: MemoryServer) {
    return new SyncEngine(
      store,
      server.transportFor(() => OWNER),
      () => true,
    );
  }

  it("reaches the other tab when a change arrives from another device", async () => {
    const { a, b, settled } = await tabs();
    const server = new MemoryServer();
    // Another device of the account, with a database of its own.
    databases += 1;
    const phoneName = `tabs-test-phone-${String(databases)}`;
    const phone = new EncryptedRecordStore(() => phoneName);
    phone.unlock(await rootKey(), OWNER);
    const saved = await entry("Written on the phone");
    await phone.put("journal-entry", saved);
    await syncing(phone, server).sync();
    expect(await b.list("journal-entry")).toEqual([]);

    // Only the first tab syncs: one tab at a time does (ADR-0006).
    await syncing(a, server).sync();
    await settled(b);

    expect(await b.list("journal-entry")).toEqual([saved]);
  });

  it("tells the other tab when the server has accepted what was waiting", async () => {
    const { a, b, hub, settled } = await tabs();
    const server = new MemoryServer();
    await a.put("journal-entry", await entry());
    await settled(b);
    expect(await b.pendingCount()).toBe(1);
    const before = hub.posted.length;
    let told = 0;
    b.subscribe(() => {
      told += 1;
    });

    await syncing(a, server).sync();
    await settled(b);

    // No record changed, only what is waiting to be sent. That is counted
    // from the stored rows, so the second tab's listeners must be told to
    // look again or its status line would go on saying "1 waiting".
    expect(hub.posted.length).toBeGreaterThan(before);
    expect(told).toBeGreaterThan(0);
    expect(await b.pendingCount()).toBe(0);
  });
});

describe("a record the other tab cannot read", () => {
  it("is counted as unreadable and shown nowhere, however often it is read", async () => {
    const hub = new Hub();
    databases += 1;
    const name = `tabs-test-unreadable-${String(databases)}`;
    const a = new EncryptedRecordStore(() => name, hub.channel);
    a.unlock(await rootKey(), OWNER);
    // The same database opened with a different key, as after a mistake
    // no screen allows: nothing the first tab stores can be read here.
    const b = new EncryptedRecordStore(() => name, hub.channel);
    b.unlock(
      await importRootKey(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)),
      OWNER,
    );
    await b.list("journal-entry");
    let told = 0;
    b.subscribe(() => {
      told += 1;
    });

    await a.put("journal-entry", await entry());
    await hub.delivered();
    await b.caughtUp();

    expect(await b.list("journal-entry")).toEqual([]);
    expect(await b.unreadable("journal-entry")).toBe(1);
    expect(told).toBeGreaterThan(0);

    // Told again with nothing new stored: it is read again and still
    // cannot be read. It is not counted twice.
    hub.forge(name, "changed");
    await b.caughtUp();

    expect(await b.list("journal-entry")).toEqual([]);
    expect(await b.unreadable("journal-entry")).toBe(1);
  });
});

describe("what is said between tabs", () => {
  it("holds nothing the person wrote and names no record", async () => {
    const { a, b, hub, settled } = await tabs();
    const saved = await entry(CANARY);

    await a.put("journal-entry", saved);
    await settled(b);

    expect(hub.posted.length).toBeGreaterThan(0);
    const said = JSON.stringify(hub.posted);
    expect(said).not.toContain(CANARY);
    expect(said).not.toContain(saved.id);
    expect(said).not.toContain(saved.contentHash);
    expect(new Set(hub.posted.map((each) => JSON.stringify(each)))).toEqual(
      new Set(['"changed"']),
    );
  });

  it("is not answered: taking in the other tab's change announces nothing", async () => {
    const { a, b, hub, settled } = await tabs();

    await a.put("journal-entry", await entry());
    await settled(b);
    await settled(a);

    // One change, one message. Two tabs that answered each other would
    // never stop.
    expect(hub.posted).toHaveLength(1);
  });

  it("is used only as a nudge: a forged message changes nothing that is stored", async () => {
    const { a, b, hub, settled, name } = await tabs();
    const saved = await entry();
    await a.put("journal-entry", saved);
    await settled(b);
    const held = await b.get("journal-entry", saved.id);

    hub.forge(name, { delete: saved.id, record: { id: saved.id, text: "x" } });
    hub.forge(name, "changed");
    await settled(b);

    expect(await b.get("journal-entry", saved.id)).toBe(held);
    expect(await a.reload("journal-entry", saved.id)).toEqual(saved);
  });

  it("goes only to tabs of the same account's database", async () => {
    const { hub, name } = await tabs();

    expect(new Set(hub.names)).toEqual(new Set([name]));
  });
});

describe("a tab that is locked", () => {
  it("stops listening, and takes nothing in", async () => {
    const { a, b, hub, name } = await tabs();
    await b.list("journal-entry");
    expect(hub.listening(name)).toBe(2);

    b.lock();

    expect(hub.listening(name)).toBe(1);
    await a.put("journal-entry", await entry());
    await hub.delivered();
    await b.caughtUp();
    expect(await b.list("journal-entry")).toEqual([]);
  });

  it("shows what the other tab stored once it is unlocked again", async () => {
    const { a, b, settled } = await tabs();
    b.lock();
    const saved = await entry();
    await a.put("journal-entry", saved);

    b.unlock(await rootKey(), OWNER);
    await settled(b);

    expect(await b.list("journal-entry")).toEqual([saved]);
  });
});

describe("a browser with no way for tabs to talk", () => {
  it("stores and reads as before", async () => {
    databases += 1;
    const name = `tabs-test-none-${String(databases)}`;
    const store = new EncryptedRecordStore(
      () => name,
      () => undefined,
    );
    store.unlock(await rootKey(), OWNER);
    const saved = await entry();

    await store.put("journal-entry", saved);
    await store.caughtUp();

    expect(await store.list("journal-entry")).toEqual([saved]);
  });

  it("is the default when the store is given no channel", async () => {
    databases += 1;
    const name = `tabs-test-default-${String(databases)}`;
    const store = new EncryptedRecordStore(() => name);
    store.unlock(await rootKey(), OWNER);
    const saved = await entry();

    await store.put("journal-entry", saved);

    expect(await store.get("journal-entry", saved.id)).toEqual(saved);
  });
});
