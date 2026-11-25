import { describe, expect, it } from "vitest";

import { ApiClient } from "../../../src/api/client";
import { fromBase64, toBase64, utf8 } from "../../../src/crypto/encoding";
import type { SyncOperation } from "../../../src/sync/protocol";
import {
  ApiSyncTransport,
  SyncCursorError,
  SyncRefusedError,
  SyncUnavailableError,
  UNAVAILABLE_TRANSPORT,
} from "../../../src/sync/transport";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import { MemoryIdentityStore, json, server } from "../devices/helpers";

const PHRASE = ["correct", "horse", "battery"].join(" ");
const PAYLOAD = utf8("synthetic ciphertext");

const OPERATION: SyncOperation = {
  opId: "00000000-0000-4000-8000-000000000001",
  recordId: "11111111-1111-4111-8111-111111111111",
  type: 1,
  baseRevision: 0,
  schemaVersion: 1,
  tombstone: false,
  payload: PAYLOAD,
};
const TOMBSTONE: SyncOperation = {
  ...OPERATION,
  opId: "00000000-0000-4000-8000-000000000002",
  baseRevision: 1,
  tombstone: true,
  payload: null,
};

async function transport(
  respond: Parameters<typeof server>[0],
  options: { signedIn?: boolean; registered?: boolean } = {},
): Promise<{
  transport: ApiSyncTransport;
  api: ReturnType<typeof server>;
}> {
  const auth = new FakeAuthClient();
  const identities = new MemoryIdentityStore();
  if (options.signedIn !== false) {
    await auth.register("sam@example.com", PHRASE);
    await auth.completeVerification();
    if (options.registered !== false) {
      const session = await auth.currentSession();
      await identities.getOrCreate(session?.userId ?? "");
    }
  }
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

function results(...statuses: [string, object][]): Response {
  return json(200, {
    results: statuses.map(([op_id, rest]) => ({ op_id, ...rest })),
  });
}

describe("sending operations to the Warmly API (SYNC-002)", () => {
  it("sends a signed batch with ciphertext as base64 and nothing else about the record", async () => {
    const { transport: sync, api } = await transport(() =>
      results(
        [OPERATION.opId, { status: "applied", revision: 1 }],
        [TOMBSTONE.opId, { status: "conflict", current_revision: 4 }],
      ),
    );

    const answer = await sync.push([OPERATION, TOMBSTONE]);

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url).toBe("https://api.example/v1/sync/operations");
    expect(api.calls[0]?.init.method).toBe("POST");
    expect(api.calls[0]?.headers["Warmly-Signature"]).toBeTruthy();
    expect(api.calls[0]?.headers["Warmly-Device"]).toBeTruthy();
    expect(JSON.parse(api.calls[0]?.body ?? "")).toEqual({
      operations: [
        {
          op_id: OPERATION.opId,
          record_id: OPERATION.recordId,
          type: 1,
          base_revision: 0,
          schema_version: 1,
          tombstone: false,
          payload: toBase64(PAYLOAD),
        },
        {
          op_id: TOMBSTONE.opId,
          record_id: OPERATION.recordId,
          type: 1,
          base_revision: 1,
          schema_version: 1,
          tombstone: true,
          payload: null,
        },
      ],
    });
    expect(answer).toEqual([
      { opId: OPERATION.opId, status: "applied", revision: 1 },
      { opId: TOMBSTONE.opId, status: "conflict", currentRevision: 4 },
    ]);
  });

  it("reads a result with null revision fields as having none", async () => {
    const { transport: sync } = await transport(() =>
      results([
        OPERATION.opId,
        { status: "rejected", revision: null, current_revision: null },
      ]),
    );

    expect(await sync.push([OPERATION])).toEqual([
      { opId: OPERATION.opId, status: "rejected" },
    ]);
  });

  it.each([
    ["no results", json(200, {})],
    ["results that are not a list", json(200, { results: "none" })],
    ["too few results", json(200, { results: [] })],
    [
      "a result for another operation",
      results([TOMBSTONE.opId, { status: "applied", revision: 1 }]),
    ],
    [
      "an unknown status",
      results([OPERATION.opId, { status: "merged", revision: 1 }]),
    ],
    [
      "a revision that is not a number",
      results([OPERATION.opId, { status: "applied", revision: "1" }]),
    ],
    ["a result that is not an object", json(200, { results: [7] })],
    ["an error status", json(500, { code: "internal" })],
    [
      "a revision of zero",
      results([OPERATION.opId, { status: "applied", revision: 0 }]),
    ],
    [
      "a current revision that is not whole",
      results([OPERATION.opId, { status: "conflict", current_revision: 2.5 }]),
    ],
  ])("refuses an answer with %s", async (_name, response) => {
    const { transport: sync } = await transport(() => response.clone());

    await expect(sync.push([OPERATION])).rejects.toMatchObject({
      code: "unexpected",
    });
  });
});

describe("asking the Warmly API for changes (SYNC-002)", () => {
  it("asks after the cursor, signed, and turns payloads back into bytes", async () => {
    const { transport: sync, api } = await transport(() =>
      json(200, {
        changes: [
          {
            record_id: OPERATION.recordId,
            type: 1,
            revision: 2,
            sequence: 7,
            schema_version: 1,
            tombstone: false,
            etag: "synthetic-etag",
            payload: toBase64(PAYLOAD),
          },
          {
            record_id: "22222222-2222-4222-8222-222222222222",
            type: 1,
            revision: 3,
            sequence: 8,
            schema_version: 1,
            tombstone: true,
            etag: "synthetic-etag",
            payload: null,
          },
        ],
        next_cursor: "8",
        has_more: true,
      }),
    );

    const page = await sync.pull("6");

    expect(api.calls[0]?.url).toBe(
      "https://api.example/v1/sync/changes?cursor=6",
    );
    expect(api.calls[0]?.init.method).toBe("GET");
    expect(api.calls[0]?.headers["Warmly-Signature"]).toBeTruthy();
    expect(page).toEqual({
      changes: [
        {
          recordId: OPERATION.recordId,
          type: 1,
          revision: 2,
          sequence: 7,
          schemaVersion: 1,
          tombstone: false,
          payload: fromBase64(toBase64(PAYLOAD)),
        },
        {
          recordId: "22222222-2222-4222-8222-222222222222",
          type: 1,
          revision: 3,
          sequence: 8,
          schemaVersion: 1,
          tombstone: true,
          payload: null,
        },
      ],
      nextCursor: "8",
      hasMore: true,
    });
  });

  const CHANGE = {
    record_id: OPERATION.recordId,
    type: 1,
    revision: 2,
    sequence: 7,
    schema_version: 1,
    tombstone: false,
    etag: "synthetic-etag",
    payload: toBase64(PAYLOAD),
  };
  const page = (changes: unknown, rest: object = {}): Response =>
    json(200, { changes, next_cursor: "7", has_more: false, ...rest });

  it.each([
    ["no changes list", json(200, { next_cursor: "0", has_more: false })],
    ["a cursor that is not text", page([], { next_cursor: 7 })],
    ["no has_more", json(200, { changes: [], next_cursor: "0" })],
    ["a change that is not an object", page(["x"])],
    ["a change with no record ID", page([{ ...CHANGE, record_id: 5 }])],
    ["a revision that is not a number", page([{ ...CHANGE, revision: "2" }])],
    ["a live record with no payload", page([{ ...CHANGE, payload: null }])],
    ["a tombstone with a payload", page([{ ...CHANGE, tombstone: true }])],
    ["a payload that is not text", page([{ ...CHANGE, payload: 9 }])],
    ["an error status", json(503, {})],
    ["a revision of zero", page([{ ...CHANGE, revision: 0 }])],
    ["a revision that is not whole", page([{ ...CHANGE, revision: 1.5 }])],
    [
      "a sequence too large to count",
      page([{ ...CHANGE, sequence: Number.MAX_SAFE_INTEGER + 1 }]),
    ],
    ["a negative sequence", page([{ ...CHANGE, sequence: -1 }])],
    ["a schema version of zero", page([{ ...CHANGE, schema_version: 0 }])],
    ["a cursor that is not digits", page([], { next_cursor: "abc" })],
    ["an empty cursor", page([], { next_cursor: "" })],
    ["a body that is not JSON", new Response("<html>", { status: 200 })],
  ])("refuses an answer with %s", async (_name, response) => {
    const { transport: sync } = await transport(() => response.clone());

    await expect(sync.pull("0")).rejects.toMatchObject({ code: "unexpected" });
  });
});

describe("when the server does not give an answer to use (SYNC-008)", () => {
  it.each([500, 502, 503, 429])(
    "treats %i as a failure worth trying again later",
    async (status) => {
      const { transport: sync } = await transport(() => json(status, {}));

      await expect(sync.push([OPERATION])).rejects.toMatchObject({
        code: "unexpected",
      });
      await expect(sync.pull("0")).rejects.toMatchObject({
        code: "unexpected",
      });
    },
  );

  it.each([400, 403, 404, 409, 413, 422])(
    "treats %i as a refusal that sending again would not change",
    async (status) => {
      const { transport: sync } = await transport(() =>
        json(status, { code: "request.invalid" }),
      );

      await expect(sync.push([OPERATION])).rejects.toBeInstanceOf(
        SyncRefusedError,
      );
      await expect(sync.pull("0")).rejects.toBeInstanceOf(SyncRefusedError);
    },
  );

  it("says so when the server does not recognise the cursor", async () => {
    const { transport: sync } = await transport(() =>
      json(409, { code: "sync.cursor_unknown" }),
    );

    await expect(sync.pull("41")).rejects.toBeInstanceOf(SyncCursorError);
  });

  it("is a plain refusal when a refusal has no readable code", async () => {
    const { transport: sync } = await transport(
      () => new Response("not json", { status: 409 }),
    );

    await expect(sync.pull("41")).rejects.toBeInstanceOf(SyncRefusedError);
  });

  it("never carries the server's words in an error", async () => {
    const { transport: sync } = await transport(() =>
      json(422, { code: "request.invalid", detail: "SERVER-TEXT" }),
    );

    const error: unknown = await sync
      .push([OPERATION])
      .catch((e: unknown) => e);

    expect(String(error)).not.toContain("SERVER-TEXT");
    expect(JSON.stringify(error)).not.toContain("SERVER-TEXT");
  });
});

describe("when sync cannot be used (SYNC-002)", () => {
  it("is unavailable, and sends nothing, when nobody is signed in or the device has no key", async () => {
    for (const options of [{ signedIn: false }, { registered: false }]) {
      const { transport: sync, api } = await transport(
        () => json(200, {}),
        options,
      );

      await expect(sync.push([OPERATION])).rejects.toBeInstanceOf(
        SyncUnavailableError,
      );
      await expect(sync.pull("0")).rejects.toBeInstanceOf(SyncUnavailableError);
      expect(api.calls).toEqual([]);
    }
  });

  it("is offline when the server cannot be reached", async () => {
    const { transport: sync } = await transport(() => {
      throw new TypeError("synthetic network failure");
    });

    await expect(sync.pull("0")).rejects.toMatchObject({ code: "offline" });
  });

  it("the transport for a build with no server always says unavailable", async () => {
    await expect(
      UNAVAILABLE_TRANSPORT.push([OPERATION]),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
    await expect(UNAVAILABLE_TRANSPORT.pull("0")).rejects.toBeInstanceOf(
      SyncUnavailableError,
    );
  });
});
