import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../src/api/client";
import { importRootKey } from "../../../src/crypto/root-key";
import { OUTBOX, RECORDS, type StoredRecord } from "../../../src/storage/db";
import {
  EncryptedRecordStore,
  StaleRecordError,
  StoreLockedError,
} from "../../../src/storage/encrypted-record-store";
import type { RemoteChange } from "../../../src/sync/protocol";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import {
  SyncUnavailableError,
  UNAVAILABLE_TRANSPORT,
  type SyncTransport,
} from "../../../src/sync/transport";
import { readRows } from "../storage/idb-snapshot";
import { OWNER, apply, device, entry } from "./devices";

describe("two devices syncing through the server double (SYNC-002, AC-23)", () => {
  it("converge on a new record", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const written = await entry();
    await a.store.put("journal-entry", written);

    await a.sync();
    await b.sync();

    expect(await b.store.get("journal-entry", written.id)).toEqual(written);
    expect(await b.store.list("journal-entry")).toEqual([written]);
    expect(a.engine.state()).toEqual({ status: "synced", waiting: 0 });
    expect(b.engine.state()).toEqual({ status: "synced", waiting: 0 });
  });

  it("converge on an edit and then on a deletion, and the deletion stays", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const written = await entry("first wording");
    await a.store.put("journal-entry", written);
    await a.sync();
    await b.sync();

    const edited = { ...written, feelings: ["calm" as const] };
    await b.store.put("journal-entry", edited);
    await b.sync();
    await a.sync();
    expect(await a.store.get("journal-entry", written.id)).toEqual(edited);

    await a.store.delete("journal-entry", written.id);
    await a.sync();
    await b.sync();
    expect(await b.store.list("journal-entry")).toEqual([]);
    // The tombstone is on both devices and on the server; nothing brings
    // the record back.
    for (const each of [a, b]) {
      expect(await readRows<StoredRecord>(each.name, RECORDS)).toMatchObject([
        { id: written.id, tombstone: true, envelope: null, dirty: false },
      ]);
      await each.sync();
      expect(await each.store.list("journal-entry")).toEqual([]);
    }
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { recordId: written.id, tombstone: true, revision: 3 },
    ]);
  });

  it("send only ciphertext: nothing the server holds contains what was written", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    await a.store.put("journal-entry", await entry("CANARY private sentence"));

    await a.sync();

    const held = JSON.stringify(
      server.pull(OWNER, "0"),
      (_key, value: unknown) =>
        ArrayBuffer.isView(value)
          ? new TextDecoder("latin1").decode(value as Uint8Array)
          : value,
    );
    expect(held).not.toContain("CANARY");
    expect(held).not.toContain("private sentence");
  });

  it("send one operation per record, however many times it was changed", async () => {
    const server = new MemoryServer();
    const pushes: number[] = [];
    const real = server.transportFor(() => OWNER);
    const a = await device(server, {
      push: (operations) => {
        pushes.push(operations.length);
        return real.push(operations);
      },
      pull: (cursor) => real.pull(cursor),
    });
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.store.put("journal-entry", { ...written, status: "draft" });
    await a.store.put("journal-entry", { ...written, feelings: ["sad"] });
    await a.store.put("journal-entry", await entry("another"));
    expect(await readRows(a.name, OUTBOX)).toHaveLength(4);

    await a.sync();

    expect(pushes).toEqual([2]);
    expect(await readRows(a.name, OUTBOX)).toEqual([]);
    expect(server.pull(OWNER, "0").changes.map((c) => c.revision)).toEqual([
      1, 1,
    ]);
  });

  it("send more than a hundred records in batches of at most a hundred", async () => {
    const server = new MemoryServer();
    const pushes: number[] = [];
    const real = server.transportFor(() => OWNER);
    const a = await device(server, {
      push: (operations) => {
        pushes.push(operations.length);
        return real.push(operations);
      },
      pull: (cursor) => real.pull(cursor),
    });
    const template = await entry();
    for (let n = 0; n < 101; n += 1) {
      await a.store.put("journal-entry", {
        ...template,
        id: crypto.randomUUID(),
      });
    }

    await a.sync();

    expect(pushes).toEqual([100, 1]);
    expect(a.engine.state()).toEqual({ status: "synced", waiting: 0 });
  });

  it("page through a long change feed", async () => {
    const server = new MemoryServer();
    server.pageSize = 2;
    const [a, b] = [await device(server), await device(server)];
    for (let n = 0; n < 5; n += 1) {
      await a.store.put("journal-entry", await entry(`entry ${String(n)}`));
    }

    await a.sync();
    await b.sync();

    expect(await b.store.list("journal-entry")).toHaveLength(5);
  });
});

describe("a record changed in two places (SYNC-002, invariant 5)", () => {
  it("needs attention on the device that was refused, and neither version is lost", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const written = await entry("original");
    await a.store.put("journal-entry", written);
    await a.sync();
    await b.sync();
    const fromA = { ...written, feelings: ["calm" as const] };
    const fromB = { ...written, feelings: ["sad" as const] };
    await a.store.put("journal-entry", fromA);
    await b.store.put("journal-entry", fromB);

    await a.sync();
    const state = await b.sync();

    expect(state).toEqual({ status: "attention", waiting: 1 });
    expect(a.engine.state().status).toBe("synced");
    // The server kept the first; the refused device kept its own.
    expect(await a.store.get("journal-entry", written.id)).toEqual(fromA);
    expect(await b.store.get("journal-entry", written.id)).toEqual(fromB);
    expect(server.pull(OWNER, "0").changes).toMatchObject([{ revision: 2 }]);
    expect(await readRows<StoredRecord>(b.name, RECORDS)).toMatchObject([
      { dirty: true, baseRevision: 1 },
    ]);
    // Syncing again changes nothing and discards nothing.
    expect(await b.sync()).toEqual({ status: "attention", waiting: 1 });
    expect(await b.store.get("journal-entry", written.id)).toEqual(fromB);
  });

  it("an edit made on a device that had not heard of the deletion does not bring the record back", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const written = await entry("original");
    await a.store.put("journal-entry", written);
    await a.sync();
    await b.sync();
    await a.store.delete("journal-entry", written.id);
    await a.sync();
    await b.store.put("journal-entry", { ...written, feelings: ["sad"] });

    const state = await b.sync();
    await a.sync();

    expect(state.status).toBe("attention");
    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { tombstone: true, revision: 2 },
    ]);
    expect(await a.store.list("journal-entry")).toEqual([]);
  });
});

describe("the sync status (SYNC-010)", () => {
  it("counts what is waiting as records change, with no network involved", async () => {
    const a = await device(new MemoryServer(), UNAVAILABLE_TRANSPORT);
    const states: string[] = [];
    a.engine.subscribe(() => {
      const { status, waiting } = a.engine.state();
      states.push(`${status} ${String(waiting)}`);
    });
    const first = await entry();

    await a.store.put("journal-entry", first);
    await a.store.put("journal-entry", { ...first, status: "draft" });
    await a.store.put("journal-entry", await entry("second"));
    await vi.waitFor(() => {
      expect(a.engine.state()).toEqual({ status: "pending", waiting: 2 });
    });

    expect(states).toEqual(["pending 1", "pending 2"]);
  });

  it("keeps changes waiting when the server does not offer sync yet", async () => {
    const a = await device(new MemoryServer(), UNAVAILABLE_TRANSPORT);
    const written = await entry();
    await a.store.put("journal-entry", written);

    expect(await a.sync()).toEqual({ status: "pending", waiting: 1 });

    expect(await a.store.get("journal-entry", written.id)).toEqual(written);
    expect(await readRows(a.name, OUTBOX)).toHaveLength(1);
  });

  it("is offline when the browser says so, without trying the server", async () => {
    const push = vi.fn();
    const a = await device(new MemoryServer(), {
      push,
      pull: vi.fn(),
    });
    await a.store.put("journal-entry", await entry());
    a.online = false;

    expect(await a.sync()).toEqual({ status: "offline", waiting: 1 });

    expect(push).not.toHaveBeenCalled();
  });

  it("is offline when the server cannot be reached, and catches up when it can", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    await a.store.put("journal-entry", await entry());
    server.reachable = false;

    expect(await a.sync()).toEqual({ status: "offline", waiting: 1 });
    await a.store.put("journal-entry", await entry("second"));
    await vi.waitFor(() => {
      expect(a.engine.state()).toEqual({ status: "offline", waiting: 2 });
    });

    server.reachable = true;
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });
  });

  it("does not double-create when a request is repeated after its answer was lost", async () => {
    const server = new MemoryServer();
    const real = server.transportFor(() => OWNER);
    let lose = true;
    const a = await device(server, {
      push: async (operations) => {
        const results = await real.push(operations);
        if (lose) {
          lose = false;
          // The server applied the batch, but the answer never arrived.
          throw new ApiError("offline");
        }
        return results;
      },
      pull: (cursor) => real.pull(cursor),
    });
    await a.store.put("journal-entry", await entry());

    expect((await a.sync()).status).toBe("offline");
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });

    expect(server.pull(OWNER, "0").changes).toMatchObject([{ revision: 1 }]);
    expect(await readRows<StoredRecord>(a.name, RECORDS)).toMatchObject([
      { baseRevision: 1, dirty: false },
    ]);
  });

  it("keeps a record waiting when it changed again while it was being sent", async () => {
    const server = new MemoryServer();
    const real = server.transportFor(() => OWNER);
    const written = await entry();
    const later = { ...written, feelings: ["calm" as const] };
    let store: EncryptedRecordStore | undefined;
    const a = await device(server, {
      push: async (operations) => {
        const results = await real.push(operations);
        // The first time only: the record is edited again while its
        // earlier version is on its way.
        if (store !== undefined) {
          const editing = store;
          store = undefined;
          await editing.put("journal-entry", later);
        }
        return results;
      },
      pull: (cursor) => real.pull(cursor),
    });
    store = a.store;
    await a.store.put("journal-entry", written);

    expect(await a.sync()).toEqual({ status: "pending", waiting: 1 });
    expect(await readRows<StoredRecord>(a.name, RECORDS)).toMatchObject([
      { baseRevision: 1, dirty: true, localRevision: 2 },
    ]);
    expect(await readRows(a.name, OUTBOX)).toHaveLength(1);

    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });
    expect(server.pull(OWNER, "0").changes).toMatchObject([{ revision: 2 }]);
  });

  it("joins a cycle that is already running", async () => {
    const server = new MemoryServer();
    const real = server.transportFor(() => OWNER);
    const push = vi.fn((operations: Parameters<SyncTransport["push"]>[0]) =>
      real.push(operations),
    );
    const a = await device(server, { push, pull: (c) => real.pull(c) });
    await a.store.put("journal-entry", await entry());

    const [first, second] = await Promise.all([a.sync(), a.sync()]);

    expect(first).toBe(second);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("stops asking when a page claims there is more but does not move on", async () => {
    const pull = vi.fn(() =>
      Promise.resolve({ changes: [], nextCursor: "0", hasMore: true }),
    );
    const a = await device(new MemoryServer(), {
      push: () => Promise.resolve([]),
      pull,
    });

    expect((await a.sync()).status).toBe("synced");

    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("starts again from nothing after a reset, and ignores a cycle that was still running", async () => {
    const server = new MemoryServer();
    const real = server.transportFor(() => OWNER);
    let release: (() => void) | undefined;
    const a = await device(server, {
      push: async (operations) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return real.push(operations);
      },
      pull: (cursor) => real.pull(cursor),
    });
    await a.store.put("journal-entry", await entry());
    await vi.waitFor(() => {
      expect(a.engine.state().status).toBe("pending");
    });
    const running = a.sync();
    // Wait until the request is really under way before locking.
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });

    a.engine.reset();
    expect(a.engine.state()).toEqual({ status: "synced", waiting: 0 });
    release?.();
    await running;

    // The cycle that was running when the app locked reports nothing.
    expect(a.engine.state()).toEqual({ status: "synced", waiting: 0 });
  });

  it("never rejects, whatever the transport does", async () => {
    const a = await device(new MemoryServer(), {
      push: () => Promise.reject(new Error("synthetic")),
      pull: () => Promise.reject(new SyncUnavailableError()),
    });
    await a.store.put("journal-entry", await entry());

    await expect(a.sync()).resolves.toEqual({ status: "failed", waiting: 1 });
  });
});

describe("the store's side of sync (ADR-0006, ADR-0014)", () => {
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

  it("has nothing pending and counts nothing while locked, and refuses changes", async () => {
    const a = await device(new MemoryServer());
    await a.store.put("journal-entry", await entry());
    const [pending] = await a.store.pending();
    a.store.lock();

    expect(await a.store.pending()).toEqual([]);
    expect(await a.store.pendingCount()).toBe(0);
    await expect(apply(a.store, change({}))).rejects.toThrow(StoreLockedError);
    if (pending === undefined) {
      throw new Error("a pending change is expected");
    }
    await expect(a.store.acknowledge(pending, 1, "current")).rejects.toThrow(
      StoreLockedError,
    );
  });

  it("builds a pending change from the record as it is now", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.store.put("journal-entry", { ...written, status: "draft" });

    const pending = await a.store.pending();

    const [row] = await readRows<StoredRecord>(a.name, RECORDS);
    expect(pending).toEqual([
      {
        operation: {
          opId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
          recordId: written.id,
          type: 1,
          baseRevision: 0,
          schemaVersion: 1,
          tombstone: false,
          payload: row?.envelope,
        },
        first: 1,
        upTo: 2,
        localRevision: 2,
      },
    ]);
  });

  it("sends a record that was created and deleted before any sync as one tombstone", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.store.delete("journal-entry", written.id);

    expect(await a.store.pending()).toMatchObject([
      { operation: { tombstone: true, payload: null, baseRevision: 0 } },
    ]);
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });

    expect(server.pull(OWNER, "0").changes).toMatchObject([
      { recordId: written.id, tombstone: true, revision: 1 },
    ]);
  });

  it("leaves a record with unsent changes alone when the server has a different version", async () => {
    const a = await device(new MemoryServer());
    const written = await entry();
    await a.store.put("journal-entry", written);
    const before = await readRows(a.name, RECORDS);

    expect(
      await apply(a.store, change({ recordId: written.id, revision: 4 })),
    ).toBe("conflict");

    expect(await readRows(a.name, RECORDS)).toEqual(before);
    expect(await a.store.get("journal-entry", written.id)).toEqual(written);
  });

  it("ignores a change it already has, and applies only newer ones", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.sync();
    const [remote] = server.pull(OWNER, "0").changes;
    if (remote === undefined) {
      throw new Error("a change is expected");
    }
    const told = vi.fn();

    expect(await apply(b.store, remote)).toBe("applied");
    b.store.subscribe(told);
    expect(await apply(b.store, remote)).toBe("unchanged");
    expect(await apply(a.store, remote)).toBe("unchanged");

    expect(told).not.toHaveBeenCalled();
    expect(await readRows<StoredRecord>(b.name, RECORDS)).toMatchObject([
      { baseRevision: 1, localRevision: 1, dirty: false },
    ]);
  });

  it("never replaces a record deleted here with a live one, whatever a server sends", async () => {
    const server = new MemoryServer();
    const a = await device(server);
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.store.delete("journal-entry", written.id);
    await a.sync();

    expect(
      await apply(
        a.store,
        change({ recordId: written.id, revision: 9, tombstone: false }),
      ),
    ).toBe("conflict");

    expect(await a.store.list("journal-entry")).toEqual([]);
    expect(await readRows<StoredRecord>(a.name, RECORDS)).toMatchObject([
      { tombstone: true },
    ]);
  });

  it("keeps a record it cannot read, counts it, and does not show it", async () => {
    const a = await device(new MemoryServer());

    expect(await apply(a.store, change({}))).toBe("applied");
    expect(await apply(a.store, change({ type: 200 }))).toBe("applied");

    expect(await a.store.list("journal-entry")).toEqual([]);
    expect(await a.store.unreadable("journal-entry")).toBe(1);
    expect(await readRows(a.name, RECORDS)).toHaveLength(2);
    expect(await a.store.pendingCount()).toBe(0);
  });

  it("makes another tab's copy out of date when a change from the server replaces a record", async () => {
    const server = new MemoryServer();
    const [a, b] = [await device(server), await device(server)];
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.sync();
    await b.sync();
    // A second tab on device b, holding the record as it was.
    const tab = new EncryptedRecordStore(() => b.name);
    tab.unlock(
      await importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i)),
      OWNER,
    );
    await tab.list("journal-entry");
    await a.store.put("journal-entry", { ...written, feelings: ["calm"] });
    await a.sync();
    await b.sync();

    await expect(
      tab.put("journal-entry", { ...written, feelings: ["sad"] }),
    ).rejects.toThrow(StaleRecordError);
  });
});
