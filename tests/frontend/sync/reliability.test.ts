import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../src/api/client";
import {
  CURSOR_KEY,
  META,
  OUTBOX,
  PARKED,
  RECORDS,
  type MetaRow,
  type ParkedRecord,
  type StoredRecord,
} from "../../../src/storage/db";
import {
  EncryptedRecordStore,
  StoreLockedError,
} from "../../../src/storage/encrypted-record-store";
import type { OutboxOperation } from "../../../src/storage/outbox";
import type { Exclusive } from "../../../src/sync/engine";
import type { RemoteChange, SyncOperation } from "../../../src/sync/protocol";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import {
  SyncCursorError,
  SyncRefusedError,
  type SyncTransport,
} from "../../../src/sync/transport";
import {
  readRows,
  restoreDatabase,
  type DatabaseSnapshot,
} from "../storage/idb-snapshot";
import { OWNER, apply, device, entry, rootKey } from "./devices";

const SNAPSHOTS = import.meta.glob<{
  owner: string;
  database: DatabaseSnapshot;
}>("../../fixtures/idb/*/snapshot.json", { eager: true, import: "default" });

afterEach(() => {
  vi.useRealTimers();
});

function change(overrides: Partial<RemoteChange>): RemoteChange {
  return {
    recordId: crypto.randomUUID(),
    type: 1,
    revision: 1,
    sequence: 1,
    schemaVersion: 1,
    tombstone: false,
    payload: new Uint8Array(40).fill(1),
    ...overrides,
  };
}

async function savedCursor(name: string): Promise<string | undefined> {
  const rows = await readRows<MetaRow>(name, META);
  return rows.find((row) => row.key === CURSOR_KEY)?.value;
}

/** A transport that passes everything on and lets a test get in the way. */
function through(
  server: MemoryServer,
  hooks: {
    push?: (
      operations: readonly SyncOperation[],
      send: SyncTransport["push"],
    ) => ReturnType<SyncTransport["push"]>;
    pull?: (
      cursor: string,
      ask: SyncTransport["pull"],
    ) => ReturnType<SyncTransport["pull"]>;
  },
): SyncTransport & { pushed: SyncOperation[][]; pulled: string[] } {
  const real = server.transportFor(() => OWNER);
  const made = {
    pushed: [] as SyncOperation[][],
    pulled: [] as string[],
    push: (operations: readonly SyncOperation[]) => {
      made.pushed.push([...operations]);
      return hooks.push?.(operations, real.push) ?? real.push(operations);
    },
    pull: (cursor: string) => {
      made.pulled.push(cursor);
      return hooks.pull?.(cursor, real.pull) ?? real.pull(cursor);
    },
  };
  return made;
}

describe("applying a page of changes (SYNC-002, AC-28)", () => {
  it("stores the records and the cursor together", async () => {
    const a = await device(new MemoryServer());
    const [first, second] = [change({ sequence: 4 }), change({ sequence: 5 })];

    expect(await a.store.cursor()).toBe("0");
    expect(await a.store.applyPage([first, second], "5")).toEqual([
      "applied",
      "applied",
    ]);

    expect(await a.store.cursor()).toBe("5");
    expect(await savedCursor(a.name)).toBe("5");
    expect(await readRows(a.name, RECORDS)).toHaveLength(2);
  });

  it("moves the cursor for an empty page too", async () => {
    const a = await device(new MemoryServer());

    expect(await a.store.applyPage([], "9")).toEqual([]);

    expect(await a.store.cursor()).toBe("9");
  });

  it("stores nothing at all, and keeps the old cursor, if the page cannot be stored whole", async () => {
    const a = await device(new MemoryServer());
    await a.store.applyPage([change({ sequence: 1 })], "1");
    const before = await readRows(a.name, RECORDS);
    const told = vi.fn();
    a.store.subscribe(told);
    // The second record cannot be written: a function is not storable.
    const broken = change({
      sequence: 3,
      payload: (() => undefined) as unknown as Uint8Array<ArrayBuffer>,
    });

    await expect(
      a.store.applyPage([change({ sequence: 2 }), broken], "3"),
    ).rejects.toThrow();

    expect(await readRows(a.name, RECORDS)).toEqual(before);
    expect(await a.store.cursor()).toBe("1");
    expect(told).not.toHaveBeenCalled();
  });

  it("remembers the cursor across a restart", async () => {
    const a = await device(new MemoryServer());
    await a.store.applyPage([change({ sequence: 6 })], "6");
    a.store.lock();

    const again = new EncryptedRecordStore(() => a.name);
    again.unlock(await rootKey(), OWNER);

    expect(await again.cursor()).toBe("6");
  });

  it("can start the feed again from the beginning", async () => {
    const a = await device(new MemoryServer());
    await a.store.applyPage([], "6");

    await a.store.forgetCursor();

    expect(await a.store.cursor()).toBe("0");
    expect(await savedCursor(a.name)).toBeUndefined();
  });

  it("says nothing and refuses changes while locked", async () => {
    const a = await device(new MemoryServer());
    await a.store.applyPage([], "6");
    a.store.lock();

    expect(await a.store.cursor()).toBe("0");
    expect(await a.store.parkedCount()).toBe(0);
    await expect(a.store.applyPage([], "7")).rejects.toThrow(StoreLockedError);
    await expect(a.store.forgetCursor()).rejects.toThrow(StoreLockedError);
  });

  it("reads the cursor and the kept version from a version 2 database", async () => {
    const snapshot = SNAPSHOTS["../../fixtures/idb/v2/snapshot.json"];
    if (snapshot === undefined) {
      throw new Error("the v2 snapshot is expected");
    }
    const name = "reliability-v2";
    await restoreDatabase(name, snapshot.database);
    const store = new EncryptedRecordStore(() => name);
    store.unlock(await rootKey(), snapshot.owner);

    expect(await store.cursor()).toBe("7");
    expect(await store.parkedCount()).toBe(1);
  });
});

describe("a server version that cannot replace a local one (SYNC-002, invariant 5)", () => {
  it("is kept beside the local record, still encrypted, and the cursor moves on", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);
    const before = await readRows(a.name, RECORDS);
    const theirs = change({ recordId: written.id, revision: 4, sequence: 9 });

    expect(await a.store.applyPage([theirs], "9")).toEqual(["conflict"]);

    expect(await readRows(a.name, RECORDS)).toEqual(before);
    expect(await a.store.get("journal-entry", written.id)).toEqual(written);
    const [kept] = await readRows<ParkedRecord>(a.name, PARKED);
    expect({ ...kept, envelope: Array.from(kept?.envelope ?? []) }).toEqual({
      type: 1,
      id: written.id,
      envelope: Array.from(theirs.payload ?? []),
      schemaVersion: 1,
      revision: 4,
      tombstone: false,
    });
    expect(await a.store.parkedCount()).toBe(1);
    expect(await a.store.cursor()).toBe("9");
  });

  it("keeps only the newest server version", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);

    await apply(a.store, change({ recordId: written.id, revision: 4 }));
    await apply(
      a.store,
      change({
        recordId: written.id,
        revision: 5,
        tombstone: true,
        payload: null,
      }),
    );

    expect(await readRows<ParkedRecord>(a.name, PARKED)).toMatchObject([
      { revision: 5, tombstone: true, envelope: null },
    ]);
  });

  it("is let go once the server accepts this device's version on top of it", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);
    await apply(a.store, change({ recordId: written.id, revision: 4 }));
    const [pending] = await a.store.pending();
    if (pending === undefined) {
      throw new Error("a pending change is expected");
    }

    await a.store.acknowledge(pending, 3, "current");
    expect(await a.store.parkedCount()).toBe(1);

    await a.store.acknowledge(pending, 5, "current");
    expect(await a.store.parkedCount()).toBe(0);
  });

  it("is let go when a later server version replaces a record with nothing unsent", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.sync();
    // Left over from an earlier clash, with the local record since settled.
    await a.store.put("journal-entry", { ...written, feelings: ["calm"] });
    await apply(a.store, change({ recordId: written.id, revision: 7 }));
    const [pending] = await a.store.pending();
    if (pending === undefined) {
      throw new Error("a pending change is expected");
    }
    await a.store.acknowledge(pending, 2, "current");
    expect(await a.store.parkedCount()).toBe(1);

    expect(
      await apply(a.store, change({ recordId: written.id, revision: 8 })),
    ).toBe("applied");

    expect(await a.store.parkedCount()).toBe(0);
  });

  it("is not kept when it is older than what this device's change was made on", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.sync();
    await a.store.put("journal-entry", { ...written, feelings: ["calm"] });
    await a.sync();
    // Unsent, on top of revision 2. The feed is then read again from the
    // start and an out-of-date page still carries revision 1.
    await a.store.put("journal-entry", { ...written, feelings: ["sad"] });

    expect(
      await apply(a.store, change({ recordId: written.id, revision: 1 })),
    ).toBe("unchanged");
    expect(
      await apply(a.store, change({ recordId: written.id, revision: 2 })),
    ).toBe("unchanged");

    expect(await a.store.parkedCount()).toBe(0);
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });
  });

  it("keeps a deletion made elsewhere beside an unsent change, and deletes nothing here", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);

    expect(
      await apply(
        a.store,
        change({
          recordId: written.id,
          revision: 3,
          tombstone: true,
          payload: null,
        }),
      ),
    ).toBe("conflict");

    expect(await a.store.get("journal-entry", written.id)).toEqual(written);
    expect(await readRows<ParkedRecord>(a.name, PARKED)).toMatchObject([
      { id: written.id, tombstone: true, envelope: null },
    ]);
  });

  it("is not kept for a record already deleted here: that record never comes back", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.store.delete("journal-entry", written.id);
    await a.sync();

    expect(
      await apply(a.store, change({ recordId: written.id, revision: 9 })),
    ).toBe("conflict");

    expect(await a.store.parkedCount()).toBe(0);
    expect(await a.store.list("journal-entry")).toEqual([]);
  });
});

describe("an answer that never arrived (SYNC-008, AC-28)", () => {
  it("sends a record under the ID of its oldest unsent change", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.store.put("journal-entry", { ...written, feelings: ["calm"] });
    const queued = await readRows<OutboxOperation>(a.name, OUTBOX);

    const [pending] = await a.store.pending();

    expect(queued).toHaveLength(2);
    expect(pending).toMatchObject({
      operation: { opId: queued[0]?.opId },
      first: queued[0]?.seq,
      upTo: queued[1]?.seq,
    });
  });

  it("settles only the oldest change when told an earlier attempt got through", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.store.put("journal-entry", { ...written, feelings: ["calm"] });
    const queued = await readRows<OutboxOperation>(a.name, OUTBOX);
    const [pending] = await a.store.pending();
    if (pending === undefined) {
      throw new Error("a pending change is expected");
    }

    await a.store.acknowledge(pending, 1, "earlier");

    expect(await readRows<OutboxOperation>(a.name, OUTBOX)).toEqual([
      queued[1],
    ]);
    expect(await readRows<StoredRecord>(a.name, RECORDS)).toMatchObject([
      { baseRevision: 1, dirty: true },
    ]);
    expect(await a.store.pending()).toMatchObject([
      { operation: { opId: queued[1]?.opId, baseRevision: 1 } },
    ]);
  });

  it("does not turn an edit made after a lost answer into a clash with itself", async () => {
    const server = new MemoryServer();
    let lose = true;
    const transport = through(server, {
      push: async (operations, send) => {
        const results = await send(operations);
        if (lose) {
          lose = false;
          // The server applied the change; the answer never arrived.
          throw new ApiError("offline");
        }
        return results;
      },
    });
    const a = await device(server, transport);
    const written = await entry();
    const edited = { ...written, feelings: ["calm" as const] };
    await a.store.put("journal-entry", written);
    expect((await a.sync()).status).toBe("offline");

    await a.store.put("journal-entry", edited);
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });

    // The retry reused the first ID; the edit then went on top of it.
    expect(transport.pushed.map((batch) => batch[0]?.opId)).toEqual([
      transport.pushed[0]?.[0]?.opId,
      transport.pushed[0]?.[0]?.opId,
      expect.not.stringMatching(transport.pushed[0]?.[0]?.opId ?? "") as string,
    ]);
    expect(server.pull(OWNER, "0").changes).toMatchObject([{ revision: 2 }]);
    const b = await device(server);
    await b.sync();
    expect(await b.store.get("journal-entry", written.id)).toEqual(edited);
    expect(await readRows(a.name, OUTBOX)).toEqual([]);
    expect(await a.store.parkedCount()).toBe(0);
  });

  it("creates each record once when a cycle is cut off and resumed", async () => {
    const server = new MemoryServer();
    let cut: ((error: Error) => void) | undefined;
    let frozen = true;
    const transport = through(server, {
      push: async (operations, send) => {
        const results = await send(operations);
        if (!frozen) {
          return results;
        }
        frozen = false;
        // The page was frozen with the request in flight. When it wakes,
        // the request fails although the server had applied it.
        return new Promise((_resolve, reject) => {
          cut = reject;
        });
      },
    });
    const a = await device(server, transport);
    await a.store.put("journal-entry", await entry("one"));
    await a.store.put("journal-entry", await entry("two"));

    const interrupted = a.sync();
    await vi.waitFor(() => {
      expect(cut).toBeDefined();
    });
    // A cycle asked for while frozen joins the one in flight.
    expect(a.sync()).toBe(interrupted);
    cut?.(new ApiError("offline"));
    expect((await interrupted).status).toBe("offline");
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });

    const stored = server.pull(OWNER, "0").changes;
    expect(stored.map((each) => each.revision)).toEqual([1, 1]);
    expect(transport.pushed[1]?.map((each) => each.opId)).toEqual(
      transport.pushed[0]?.map((each) => each.opId),
    );
  });
});

describe("the cursor across cycles and restarts (SYNC-002)", () => {
  it("asks only for what is new, even after a restart", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    await a.store.put("journal-entry", await entry("one"));
    await a.sync();
    const first = through(server, {});
    const b = await device(server, first);
    await b.sync();
    await a.store.put("journal-entry", await entry("two"));
    await a.sync();
    b.store.lock();

    const second = through(server, {});
    const restarted = await device(server, second, { name: b.name });
    await restarted.sync();

    expect(first.pulled).toEqual(["0"]);
    expect(second.pulled).toEqual(["1"]);
    expect(await restarted.store.list("journal-entry")).toHaveLength(2);
  });

  it("reads the feed again from the start when the server does not know the cursor", async () => {
    const old = new MemoryServer();
    const a = await device(old);
    const mine = await entry("mine");
    await a.store.put("journal-entry", mine);
    await a.sync();
    expect(await a.store.cursor()).toBe("1");
    a.store.lock();
    // The same account on a server that has a shorter history.
    const server = new MemoryServer();
    const transport = through(server, {});
    const again = await device(server, transport, { name: a.name });

    expect(await again.sync()).toEqual({ status: "synced", waiting: 0 });

    expect(transport.pulled).toEqual(["1", "0"]);
    expect(await again.store.cursor()).toBe("0");
    expect(await again.store.get("journal-entry", mine.id)).toEqual(mine);
  });

  it("gives up for now if the server refuses the start of the feed as well", async () => {
    const server = new MemoryServer();
    const transport = through(server, {
      pull: () => Promise.reject(new SyncCursorError()),
    });
    const a = await device(server, transport);

    expect((await a.sync()).status).toBe("failed");

    expect(transport.pulled).toEqual(["0", "0"]);
    expect(a.engine.outcome()).toBe("stopped");
  });
});

describe("how a cycle that did not finish is reported (SYNC-010)", () => {
  it.each([
    ["the server fails", new ApiError("unexpected"), "failed", "retry"],
    [
      "the server refuses the request",
      new SyncRefusedError(),
      "failed",
      "stopped",
    ],
    ["the session has ended", new ApiError("signed_out"), "failed", "stopped"],
    [
      "the device clock is wrong",
      new ApiError("clock_wrong"),
      "failed",
      "stopped",
    ],
    ["the network is down", new ApiError("offline"), "offline", "offline"],
    ["something else breaks", new Error("synthetic"), "failed", "stopped"],
  ] as const)("when %s", async (_name, error, status, outcome) => {
    const server = new MemoryServer();
    const a = await device(
      server,
      through(server, { push: () => Promise.reject(error) }),
    );
    await a.store.put("journal-entry", await entry());

    expect(await a.sync()).toEqual({ status, waiting: 1 });

    expect(a.engine.outcome()).toBe(outcome);
    // Nothing was lost: the change is still queued.
    expect(await readRows(a.name, OUTBOX)).toHaveLength(1);
  });

  it("keeps saying it failed as more is written, until a cycle works", async () => {
    const server = new MemoryServer();
    let failing = true;
    const a = await device(
      server,
      through(server, {
        push: (operations, send) =>
          failing
            ? Promise.reject(new ApiError("unexpected"))
            : send(operations),
      }),
    );
    await a.store.put("journal-entry", await entry("one"));
    await a.sync();

    await a.store.put("journal-entry", await entry("two"));
    await vi.waitFor(() => {
      expect(a.engine.state()).toEqual({ status: "failed", waiting: 2 });
    });

    failing = false;
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });
    expect(a.engine.outcome()).toBe("done");
  });

  it("keeps what the server accepted when the session ends part-way through", async () => {
    const server = new MemoryServer();
    let signedIn = false;
    const a = await device(
      server,
      through(server, {
        pull: (cursor, ask) =>
          signedIn ? ask(cursor) : Promise.reject(new ApiError("signed_out")),
      }),
    );
    const written = await entry();
    await a.store.put("journal-entry", written);

    // The push is accepted; the pull is refused with a 401.
    expect(await a.sync()).toEqual({ status: "failed", waiting: 0 });
    expect(await readRows(a.name, OUTBOX)).toEqual([]);
    expect(await a.store.get("journal-entry", written.id)).toEqual(written);

    signedIn = true;
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });
    expect(server.pull(OWNER, "0").changes).toHaveLength(1);
  });

  it("forgets the last outcome when the app locks", async () => {
    const server = new MemoryServer();
    const a = await device(
      server,
      through(server, { push: () => Promise.reject(new ApiError("offline")) }),
    );
    await a.store.put("journal-entry", await entry());
    await a.sync();

    a.engine.reset();

    expect(a.engine.outcome()).toBe("done");
    expect(a.engine.state()).toEqual({ status: "synced", waiting: 0 });
  });
});

describe("two tabs on one device (SYNC-008)", () => {
  /** One lock shared by every engine given it, like the browser's. */
  function sharedLock(): Exclusive {
    let held = false;
    return async (work) => {
      if (held) {
        return undefined;
      }
      held = true;
      try {
        return await work();
      } finally {
        held = false;
      }
    };
  }

  it("send each queued change once when both sync at the same moment", async () => {
    const server = new MemoryServer();
    const exclusive = sharedLock();
    const first = through(server, {});
    const second = through(server, {});
    const tab = await device(server, first, { exclusive });
    const other = await device(server, second, { name: tab.name, exclusive });
    await tab.store.put("journal-entry", await entry("one"));
    await tab.store.put("journal-entry", await entry("two"));

    const [mine] = await Promise.all([tab.sync(), other.sync()]);

    expect(first.pushed.length + second.pushed.length).toBe(1);
    expect([tab.engine.outcome(), other.engine.outcome()]).toEqual([
      "done",
      "busy",
    ]);
    expect(mine).toEqual({ status: "synced", waiting: 0 });
    expect(server.pull(OWNER, "0").changes).toHaveLength(2);
    // The tab that waited finds nothing left to send on its next cycle.
    expect(await other.sync()).toEqual({ status: "synced", waiting: 0 });
    expect(second.pushed).toEqual([]);
  });

  it("a tab that had to wait syncs normally afterwards", async () => {
    const server = new MemoryServer();
    const exclusive = sharedLock();
    const tab = await device(server, undefined, { exclusive });
    const other = await device(server, undefined, {
      name: tab.name,
      exclusive,
    });
    await Promise.all([tab.sync(), other.sync()]);

    await other.store.put("journal-entry", await entry());
    expect(await other.sync()).toEqual({ status: "synced", waiting: 0 });

    expect(other.engine.outcome()).toBe("done");
  });

  it("a tab that is waiting shows what is queued, not a failure", async () => {
    const server = new MemoryServer();
    const a = await device(server, undefined, {
      exclusive: () => Promise.resolve(undefined),
    });
    await a.store.put("journal-entry", await entry());

    expect(await a.sync()).toEqual({ status: "pending", waiting: 1 });
    expect(a.engine.outcome()).toBe("busy");
  });
});

describe("devices whose clocks disagree (SYNC-011)", () => {
  it("converge on the order the server saw, whatever each clock says", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const server = new MemoryServer();
    const [fast, slow] = [await device(server), await device(server)];
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 10, 25, 12);

    // The device a day ahead writes first.
    vi.setSystemTime(now + day);
    const written = await entry("from the fast clock");
    await fast.store.put("journal-entry", written);
    await fast.sync();

    // The device a day behind edits afterwards. By its clock the edit is
    // "older", and it must still be the one both devices end up with.
    vi.setSystemTime(now - day);
    await slow.sync();
    const edited = { ...written, feelings: ["calm" as const] };
    await slow.store.put("journal-entry", edited);
    expect(await slow.sync()).toEqual({ status: "synced", waiting: 0 });

    vi.setSystemTime(now + day);
    expect(await fast.sync()).toEqual({ status: "synced", waiting: 0 });

    expect(await fast.store.get("journal-entry", written.id)).toEqual(edited);
    expect(await slow.store.get("journal-entry", written.id)).toEqual(edited);
  });
});

describe("a record that needs the person, among others that do not (SYNC-002, AC-16)", () => {
  it("lets every other record sync, keeps both versions, and still says so after a restart", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const shared = await entry("shared");
    await a.store.put("journal-entry", shared);
    await a.sync();
    await b.sync();
    const mine = { ...shared, feelings: ["calm" as const] };
    const theirs = { ...shared, feelings: ["sad" as const] };
    await a.store.put("journal-entry", mine);
    await a.sync();
    const other = await entry("unrelated");
    await b.store.put("journal-entry", theirs);
    await b.store.put("journal-entry", other);

    expect(await b.sync()).toEqual({ status: "attention", waiting: 1 });

    // The unrelated record went through in the same cycle.
    await a.sync();
    expect(await a.store.get("journal-entry", other.id)).toEqual(other);
    // Both versions of the shared record still exist on b.
    expect(await b.store.get("journal-entry", shared.id)).toEqual(theirs);
    expect(await readRows<ParkedRecord>(b.name, PARKED)).toMatchObject([
      { id: shared.id, revision: 2, tombstone: false },
    ]);
    // And a holds its own, untouched.
    expect(await a.store.get("journal-entry", shared.id)).toEqual(mine);

    b.store.lock();
    const restarted = await device(server, undefined, { name: b.name });
    await vi.waitFor(async () => {
      expect(await restarted.store.parkedCount()).toBe(1);
    });
    expect(await restarted.sync()).toEqual({ status: "attention", waiting: 1 });
  });

  it("says a record needs attention as soon as the store is opened, before any cycle", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    const written = await entry();
    await a.store.put("journal-entry", written);
    await apply(a.store, change({ recordId: written.id, revision: 4 }));

    await a.store.put("journal-entry", { ...written, feelings: ["calm"] });

    await vi.waitFor(() => {
      expect(a.engine.state()).toEqual({ status: "attention", waiting: 1 });
    });
  });
});

describe("the in-memory server and unknown cursors (ADR-0006)", () => {
  it("refuses a cursor the account was never given", () => {
    const server = new MemoryServer();

    expect(server.pull(OWNER, "0").changes).toEqual([]);
    expect(() => server.pull(OWNER, "1")).toThrow(SyncCursorError);
  });
});
