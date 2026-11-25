import { describe, expect, it } from "vitest";

import { ApiClient } from "../../../src/api/client";
import { OUTBOX } from "../../../src/storage/db";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import { SyncEngine } from "../../../src/sync/engine";
import {
  SYNC_VERSION,
  SyncServerBehindError,
  SyncUpgradeRequiredError,
  versionRefusal,
} from "../../../src/sync/compat";
import type { SyncOperation } from "../../../src/sync/protocol";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { ApiSyncTransport } from "../../../src/sync/transport";
import { describeSync } from "../../../src/ui/components/SyncStatus";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import { MemoryIdentityStore, json, server } from "../devices/helpers";
import {
  readRows,
  restoreDatabase,
  type DatabaseSnapshot,
} from "../storage/idb-snapshot";
import { device, entry, rootKey } from "./devices";

const PHRASE = ["correct", "horse", "battery"].join(" ");
const OPERATION: SyncOperation = {
  opId: "00000000-0000-4000-8000-000000000001",
  recordId: "00000000-0000-4000-8000-0000000000a1",
  type: 1,
  baseRevision: 0,
  schemaVersion: 1,
  tombstone: false,
  payload: new Uint8Array([1, 2, 3]),
};

function refusal(oldest?: string, newest?: string): Response {
  return new Response(JSON.stringify({ code: "sync.upgrade_required" }), {
    status: 426,
    headers: {
      "Content-Type": "application/problem+json",
      ...(oldest === undefined ? {} : { "Warmly-Sync-Min": oldest }),
      ...(newest === undefined ? {} : { "Warmly-Sync-Max": newest }),
    },
  });
}

async function transport(respond: Parameters<typeof server>[0]): Promise<{
  transport: ApiSyncTransport;
  api: ReturnType<typeof server>;
}> {
  const auth = new FakeAuthClient();
  const identities = new MemoryIdentityStore();
  await auth.register("sam@example.com", PHRASE);
  await auth.completeVerification();
  const session = await auth.currentSession();
  await identities.getOrCreate(session?.userId ?? "");
  const api = server(respond);
  return {
    api,
    transport: new ApiSyncTransport(
      new ApiClient("https://api.example", api.fetch, () => 1_795_651_200_000),
      auth,
      identities,
    ),
  };
}

describe("saying which sync version this build speaks (REL-004, AC-28)", () => {
  it("speaks version 1", () => {
    expect(SYNC_VERSION).toBe(1);
  });

  it("states the version on every sync request, and on nothing else in the signature", async () => {
    const { transport: sync, api } = await transport((call) =>
      call.url.includes("/operations")
        ? json(200, {
            results: [
              { op_id: OPERATION.opId, status: "applied", revision: 1 },
            ],
          })
        : json(200, { changes: [], next_cursor: "0", has_more: false }),
    );

    await sync.push([OPERATION]);
    await sync.pull("0");

    expect(api.calls).toHaveLength(2);
    for (const call of api.calls) {
      expect(call.headers["Warmly-Sync-Version"]).toBe("1");
      // The request is still signed as before.
      expect(call.headers["Warmly-Signature"]).toMatch(/^[A-Za-z0-9+/=]+$/);
    }
  });
});

describe("what a version refusal means for this build", () => {
  const headers = (oldest?: string, newest?: string): Headers =>
    refusal(oldest, newest).headers;

  it.each([
    ["the server has moved past this version", "2", "3"],
    ["the server says it still speaks this version", "1", "1"],
    ["the server speaks a range that includes this version", "1", "4"],
    ["the server does not say what it speaks", undefined, undefined],
    ["the server's answer is not a number", "x", "y"],
    ["the server's answer is not whole", "1.5", "2.5"],
    ["the server's answer is negative", "-3", "-1"],
    ["the server's answer is absurdly long", "1", "9".repeat(40)],
  ] as const)("asks for an update when %s", (_name, oldest, newest) => {
    expect(versionRefusal(headers(oldest, newest), 1)).toBeInstanceOf(
      SyncUpgradeRequiredError,
    );
  });

  it("waits when the server is older than this build", () => {
    expect(versionRefusal(headers("1", "1"), 2)).toBeInstanceOf(
      SyncServerBehindError,
    );
    expect(versionRefusal(headers("1", "2"), 3)).toBeInstanceOf(
      SyncServerBehindError,
    );
  });

  it("is what the transport raises for a 426, never the server's words", async () => {
    const { transport: tooOld } = await transport(() => refusal("2", "3"));

    const pushed: unknown = await tooOld
      .push([OPERATION])
      .catch((e: unknown) => e);
    const pulled: unknown = await tooOld.pull("0").catch((e: unknown) => e);

    expect(pushed).toBeInstanceOf(SyncUpgradeRequiredError);
    expect(pulled).toBeInstanceOf(SyncUpgradeRequiredError);
    expect(String(pushed)).not.toContain("upgrade_required");
  });
});

describe("a device whose app is too old to sync (REL-004, AC-28)", () => {
  /** A server that has moved on, in front of the real one. */
  function movedOn(server_: MemoryServer, state: { updated: boolean }) {
    const real = server_.transportFor(
      () => "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90",
    );
    const calls = { push: 0, pull: 0 };
    return {
      calls,
      push: (operations: readonly SyncOperation[]) => {
        calls.push += 1;
        return state.updated
          ? real.push(operations)
          : Promise.reject(new SyncUpgradeRequiredError());
      },
      pull: (cursor: string) => {
        calls.pull += 1;
        return state.updated
          ? real.pull(cursor)
          : Promise.reject(new SyncUpgradeRequiredError());
      },
    };
  }

  it("stops syncing, says so, and keeps every queued change", async () => {
    const server_ = new MemoryServer();
    const state = { updated: false };
    const a = await device(server_, movedOn(server_, state));
    const written = await entry();
    await a.store.put("journal-entry", written);
    const queued = await readRows(a.name, OUTBOX);

    expect(await a.sync()).toEqual({ status: "outdated", waiting: 1 });

    expect(a.engine.outcome()).toBe("outdated");
    expect(await readRows(a.name, OUTBOX)).toEqual(queued);
    expect(describeSync(a.engine.state())).toBe(
      "Update Warmly to keep syncing. Your writing is saved on this device.",
    );
  });

  it("keeps working offline: writing, editing and deleting all still store", async () => {
    const server_ = new MemoryServer();
    const a = await device(server_, movedOn(server_, { updated: false }));
    const first = await entry("first");
    await a.store.put("journal-entry", first);
    await a.sync();

    const second = await entry("second");
    await a.store.put("journal-entry", second);
    await a.store.put("journal-entry", { ...first, feelings: ["calm"] });
    await a.store.delete("journal-entry", second.id);

    expect(await a.store.list("journal-entry")).toEqual([
      { ...first, feelings: ["calm"] },
    ]);
    await expect
      .poll(() => a.engine.state())
      .toEqual({ status: "outdated", waiting: 2 });
  });

  it("sends everything it kept once the app has been updated", async () => {
    const server_ = new MemoryServer();
    const state = { updated: false };
    const a = await device(server_, movedOn(server_, state));
    const written = await entry();
    await a.store.put("journal-entry", written);
    await a.sync();

    state.updated = true;
    expect(await a.sync()).toEqual({ status: "synced", waiting: 0 });

    const b = await device(server_);
    await b.sync();
    expect(await b.store.get("journal-entry", written.id)).toEqual(written);
  });

  it("treats a server that is behind as a passing failure worth retrying", async () => {
    const server_ = new MemoryServer();
    const a = await device(server_, {
      push: () => Promise.reject(new SyncServerBehindError()),
      pull: () => Promise.reject(new SyncServerBehindError()),
    });
    await a.store.put("journal-entry", await entry());

    expect(await a.sync()).toEqual({ status: "failed", waiting: 1 });
    expect(a.engine.outcome()).toBe("retry");
    expect(await readRows(a.name, OUTBOX)).toHaveLength(1);
  });
});

describe("data written by every earlier version of the app (REL-004, §13.6)", () => {
  const SNAPSHOTS = import.meta.glob<{
    owner: string;
    database: DatabaseSnapshot;
    expected: { "journal-entry": unknown[]; deleted: string[] };
  }>("../../fixtures/idb/*/snapshot.json", { eager: true, import: "default" });

  it("has at least one earlier version to check", () => {
    expect(Object.keys(SNAPSHOTS).length).toBeGreaterThanOrEqual(2);
  });

  it.each(Object.entries(SNAPSHOTS))(
    "is opened by this version, syncs, and loses nothing: %s",
    async (path, snapshot) => {
      const name = `compat-${path.replaceAll(/[^a-z0-9]/gi, "-")}`;
      await restoreDatabase(name, snapshot.database);
      const queued = snapshot.database.stores["outbox"]?.rows.length ?? 0;
      const parked = snapshot.database.stores["parked"]?.rows.length ?? 0;
      const server_ = new MemoryServer();
      const transport_ = server_.transportFor(() => snapshot.owner);
      const store = new EncryptedRecordStore(() => name);
      store.unlock(await rootKey(), snapshot.owner);
      const engine = new SyncEngine(store, transport_, () => true);

      const before = await store.list("journal-entry");
      const state = await engine.sync();

      // Everything written before the update is still readable...
      expect(before).toHaveLength(snapshot.expected["journal-entry"].length);
      expect(await store.list("journal-entry")).toEqual(before);
      // ...what was waiting to be sent has been sent, unless it is waiting
      // for the person to choose...
      expect(queued).toBeGreaterThan(0);
      expect(state).toEqual({
        status: parked > 0 ? "attention" : "synced",
        waiting: parked,
      });
      // ...and what was deleted stays deleted, here and on the server.
      for (const id of snapshot.expected.deleted) {
        expect(await store.get("journal-entry", id)).toBeUndefined();
      }
      const stored = server_.pull(snapshot.owner, "0").changes;
      expect(
        stored.filter((each) => each.tombstone).map((each) => each.recordId),
      ).toEqual(expect.arrayContaining(snapshot.expected.deleted));
    },
  );
});
