import { describe, expect, it } from "vitest";

import { ApiError } from "../../../src/api/client";
import { utf8 } from "../../../src/crypto/encoding";
import type { SyncOperation } from "../../../src/sync/protocol";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import table from "../../fixtures/sync/scenarios-v1.json";

const OWNER = "owner-1";

interface FixtureOperation {
  readonly op_id: string;
  readonly record_id: string;
  readonly type: number;
  readonly base_revision: number;
  readonly schema_version: number;
  readonly tombstone: boolean;
  readonly payload: string | null;
}

function fromFixture(operation: FixtureOperation): SyncOperation {
  return {
    opId: operation.op_id,
    recordId: operation.record_id,
    type: operation.type,
    baseRevision: operation.base_revision,
    schemaVersion: operation.schema_version,
    tombstone: operation.tombstone,
    payload: operation.payload === null ? null : utf8(operation.payload),
  };
}

let ops = 0;

function op(
  recordId: string,
  baseRevision: number,
  changes: Partial<SyncOperation> = {},
): SyncOperation {
  ops += 1;
  return {
    opId: `op-${String(ops)}`,
    recordId,
    type: 1,
    baseRevision,
    schemaVersion: 1,
    tombstone: false,
    payload: utf8(`payload ${String(ops)}`),
    ...changes,
  };
}

describe("the in-memory server follows the ADR-0006 scenario table (SYNC-002)", () => {
  it("covers every row of the table", () => {
    expect(table.version).toBe(1);
    expect(table.scenarios.map((scenario) => scenario.name)).toEqual([
      "create",
      "update",
      "stale update",
      "delete",
      "duplicate operation",
      "edit after delete",
      "delete after delete",
      "stale delete",
      "delete of a record never synced",
      "update of a record never synced",
      "another record type",
      "a refused operation sent again is evaluated again",
    ]);
  });

  it.each(table.scenarios)("$name", (scenario) => {
    const server = new MemoryServer();

    for (const step of scenario.steps) {
      const [result] = server.push(OWNER, [fromFixture(step.operation)]);
      const expected: {
        status: string;
        revision?: number;
        current_revision?: number;
      } = step.expect;

      expect(result).toEqual({
        opId: step.operation.op_id,
        status: expected.status,
        ...(expected.revision === undefined
          ? {}
          : { revision: expected.revision }),
        ...(expected.current_revision === undefined
          ? {}
          : { currentRevision: expected.current_revision }),
      });
    }
  });
});

describe("the in-memory server's operations", () => {
  it("answers a batch in order, each operation on its own", () => {
    const server = new MemoryServer();
    const create = op("r1", 0);

    const results = server.push(OWNER, [
      create,
      op("r1", 1),
      op("r1", 1),
      op("r2", 0),
      create,
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "applied",
      "applied",
      "conflict",
      "applied",
      "duplicate",
    ]);
    expect(results.map((result) => result.opId)).toEqual([
      create.opId,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      create.opId,
    ]);
  });

  it("refuses an empty batch and one that is too large", () => {
    const server = new MemoryServer();

    expect(() => server.push(OWNER, [])).toThrow(ApiError);
    expect(() =>
      server.push(
        OWNER,
        Array.from({ length: 101 }, (_, n) => op(`r${String(n)}`, 0)),
      ),
    ).toThrow(ApiError);
    expect(
      server.push(
        OWNER,
        Array.from({ length: 100 }, (_, n) => op(`r${String(n)}`, 0)),
      ),
    ).toHaveLength(100);
  });

  it("keeps a deleted record's revision and drops its payload", () => {
    const server = new MemoryServer();
    server.push(OWNER, [op("r1", 0)]);

    server.push(OWNER, [op("r1", 1, { tombstone: true, payload: null })]);

    expect(server.pull(OWNER, "0").changes).toEqual([
      {
        recordId: "r1",
        type: 1,
        revision: 2,
        sequence: 2,
        schemaVersion: 1,
        tombstone: true,
        payload: null,
      },
    ]);
  });

  it("keeps each account's records apart, even under the same record ID", () => {
    const server = new MemoryServer();
    const mine = op("shared-id", 0);
    server.push(OWNER, [mine]);

    expect(server.pull("owner-2", "0").changes).toEqual([]);
    expect(server.push("owner-2", [op("shared-id", 1)])[0]?.status).toBe(
      "rejected",
    );
    // The other account's operation ID means nothing here either.
    expect(server.push("owner-2", [mine])[0]?.status).toBe("applied");
    expect(server.pull(OWNER, "0").changes).toHaveLength(1);
  });
});

describe("the in-memory server's change feed (SYNC-002)", () => {
  it("lists each changed record once, as it is now, oldest change first", () => {
    const server = new MemoryServer();
    const first = op("r1", 0);
    const second = op("r2", 0);
    const again = op("r1", 1);
    server.push(OWNER, [first, second, again]);

    const page = server.pull(OWNER, "0");

    expect(
      page.changes.map((change) => [
        change.recordId,
        change.revision,
        change.sequence,
      ]),
    ).toEqual([
      ["r2", 1, 2],
      ["r1", 2, 3],
    ]);
    expect(page.changes[1]?.payload).toEqual(again.payload);
    expect(page.nextCursor).toBe("3");
    expect(page.hasMore).toBe(false);
  });

  it("returns only what changed after the cursor, and the same cursor when nothing did", () => {
    const server = new MemoryServer();
    server.push(OWNER, [op("r1", 0), op("r2", 0)]);

    expect(server.pull(OWNER, "1").changes.map((c) => c.recordId)).toEqual([
      "r2",
    ]);
    expect(server.pull(OWNER, "2")).toEqual({
      changes: [],
      nextCursor: "2",
      hasMore: false,
    });
    expect(server.pull(OWNER, "0").nextCursor).toBe("2");
  });

  it("pages through a long feed without missing or repeating a record", () => {
    const server = new MemoryServer();
    server.pageSize = 2;
    server.push(
      OWNER,
      ["a", "b", "c", "d", "e"].map((id) => op(id, 0)),
    );

    const seen: string[] = [];
    let cursor = "0";
    let pages = 0;
    for (;;) {
      const page = server.pull(OWNER, cursor);
      seen.push(...page.changes.map((change) => change.recordId));
      cursor = page.nextCursor;
      pages += 1;
      if (!page.hasMore) {
        break;
      }
    }

    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
    expect(pages).toBe(3);
    expect(cursor).toBe("5");
  });

  it.each(["", "abc", "-1", "1.5", "99999999999999999999"])(
    "refuses the cursor %j",
    (cursor) => {
      expect(() => new MemoryServer().pull(OWNER, cursor)).toThrow(ApiError);
    },
  );

  it("refused operations do not appear in the feed", () => {
    const server = new MemoryServer();
    server.push(OWNER, [op("r1", 0), op("r1", 0), op("r2", 3)]);

    expect(server.pull(OWNER, "0").changes.map((c) => c.recordId)).toEqual([
      "r1",
    ]);
  });
});

describe("a device's transport to the in-memory server", () => {
  it("reaches the server as the account the device is signed in to", async () => {
    const server = new MemoryServer();
    const mine = server.transportFor(() => OWNER);
    const theirs = server.transportFor(() => Promise.resolve("owner-2"));

    expect((await mine.push([op("r1", 0)]))[0]?.status).toBe("applied");

    expect((await mine.pull("0")).changes).toHaveLength(1);
    expect((await theirs.pull("0")).changes).toEqual([]);
  });

  it("fails as offline while the server cannot be reached, and works again after", async () => {
    const server = new MemoryServer();
    const transport = server.transportFor(() => OWNER);
    server.reachable = false;

    await expect(transport.push([op("r1", 0)])).rejects.toMatchObject({
      code: "offline",
    });
    await expect(transport.pull("0")).rejects.toMatchObject({
      code: "offline",
    });

    server.reachable = true;
    expect((await transport.pull("0")).changes).toEqual([]);
  });
});
