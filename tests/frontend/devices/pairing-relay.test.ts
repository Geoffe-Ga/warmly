import { beforeEach, describe, expect, it } from "vitest";

import { ApiClient } from "../../../src/api/client";
import type { AuthSession } from "../../../src/auth/auth-client";
import {
  ApiPairingRelay,
  type PairingStart,
} from "../../../src/devices/pairing-relay";
import {
  FAKE_PAIRING_STORAGE_KEY,
  FakePairingRelay,
} from "../../../src/testing/fake-pairing-relay";
import { SESSION, json, server, testIdentity, type Call } from "./helpers";

const OTHER: AuthSession = {
  userId: "0a1b2c3d-0000-4000-8000-00000000000b",
  accessToken: "synthetic-access-token",
};
const ID = "44444444-4444-4444-8444-444444444444";
const START: PairingStart = {
  deviceId: "d0000000-0000-4000-8000-00000000000a",
  publicKey: "a2V5",
  commitment: "Y29tbWl0",
};
const WIRE = {
  id: ID,
  device_id: START.deviceId,
  public_key: "a2V5",
  commitment: "Y29tbWl0",
  challenge: "Y2hhbGxlbmdl",
  status: "pending",
  expires_at: "2026-11-25T10:05:00Z",
  approver_nonce: null,
  joiner_nonce: null,
  wrapped_key: null,
};

function api(respond: (call: Call) => Response): {
  calls: Call[];
  relay: ApiPairingRelay;
} {
  const fake = server(respond);
  return {
    calls: fake.calls,
    relay: new ApiPairingRelay(
      new ApiClient("", fake.fetch, () => 1_795_651_200_000),
    ),
  };
}

describe("the pairing relay on the Warmly API (DEV-001 path A)", () => {
  it("starts a request without a device signature, sending only public values", async () => {
    const { calls, relay } = api(() => json(201, WIRE));

    const request = await relay.start(SESSION, START);

    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toBe("/v1/enrollments");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      device_id: START.deviceId,
      public_key: "a2V5",
      commitment: "Y29tbWl0",
    });
    expect(calls[0]?.headers["Warmly-Signature"]).toBeUndefined();
    expect(request).toEqual({
      id: ID,
      deviceId: START.deviceId,
      publicKey: "a2V5",
      commitment: "Y29tbWl0",
      challenge: "Y2hhbGxlbmdl",
      status: "pending",
      expiresAt: "2026-11-25T10:05:00Z",
      approverNonce: undefined,
      joinerNonce: undefined,
      wrappedKey: undefined,
    });
  });

  it("reads every field of a finished request", async () => {
    const { relay } = api(() =>
      json(200, {
        ...WIRE,
        status: "approved",
        approver_nonce: "YQ==",
        joiner_nonce: "ag==",
        wrapped_key: "dw==",
      }),
    );

    expect(await relay.read(SESSION, ID)).toMatchObject({
      status: "approved",
      approverNonce: "YQ==",
      joinerNonce: "ag==",
      wrappedKey: "dw==",
    });
  });

  it("the new device's calls are unsigned; the approving device's are signed", async () => {
    const identity = await testIdentity();
    const { calls, relay } = api(() => json(200, WIRE));

    await relay.read(SESSION, ID);
    await relay.reveal(SESSION, ID, "ag==");
    await relay.openRequest(SESSION, identity);
    await relay.claim(SESSION, identity, ID, "YQ==");
    await relay.approve(SESSION, identity, ID, "dw==");
    await relay.reject(SESSION, identity, ID);

    expect(
      calls.map((call) => [
        call.init.method,
        call.url,
        call.body,
        call.headers["Warmly-Device"] !== undefined,
      ]),
    ).toEqual([
      ["GET", `/v1/enrollments/${ID}`, "", false],
      [
        "POST",
        `/v1/enrollments/${ID}/reveal`,
        '{"joiner_nonce":"ag=="}',
        false,
      ],
      ["GET", "/v1/enrollments/open", "", true],
      [
        "POST",
        `/v1/enrollments/${ID}/claim`,
        '{"approver_nonce":"YQ=="}',
        true,
      ],
      ["POST", `/v1/enrollments/${ID}/approve`, '{"wrapped_key":"dw=="}', true],
      ["POST", `/v1/enrollments/${ID}/reject`, "", true],
    ]);
  });

  it("escapes the request ID, so it cannot change the path", async () => {
    const { calls, relay } = api(() => json(404, {}));

    await relay.read(SESSION, "../x?y");

    expect(calls[0]?.url).toBe("/v1/enrollments/..%2Fx%3Fy");
  });

  it.each([404, 409])(
    "reports a step that cannot happen (%i) as undefined",
    async (status) => {
      const identity = await testIdentity();
      const { relay } = api(() => json(status, { code: "enrollment.x" }));

      expect(await relay.read(SESSION, ID)).toBeUndefined();
      expect(await relay.openRequest(SESSION, identity)).toBeUndefined();
      expect(await relay.claim(SESSION, identity, ID, "YQ==")).toBeUndefined();
      expect(await relay.reveal(SESSION, ID, "ag==")).toBeUndefined();
      expect(
        await relay.approve(SESSION, identity, ID, "dw=="),
      ).toBeUndefined();
      await expect(
        relay.reject(SESSION, identity, ID),
      ).resolves.toBeUndefined();
    },
  );

  it("fails on a server error, including when starting", async () => {
    const { relay } = api(() => json(500, {}));

    await expect(relay.start(SESSION, START)).rejects.toMatchObject({
      code: "unexpected",
    });
    await expect(relay.read(SESSION, ID)).rejects.toMatchObject({
      code: "unexpected",
    });
  });

  it.each([
    ["a null body", null],
    ["a body that is not an object", "request"],
    ["no ID", { ...WIRE, id: undefined }],
    ["a device ID that is not text", { ...WIRE, device_id: 7 }],
    ["no public key", { ...WIRE, public_key: null }],
    ["no commitment", { ...WIRE, commitment: null }],
    ["no challenge", { ...WIRE, challenge: null }],
    ["no expiry", { ...WIRE, expires_at: null }],
    ["no status", { ...WIRE, status: null }],
    ["a status it does not know", { ...WIRE, status: "done" }],
  ])("refuses a response with %s", async (_name, body) => {
    const { relay } = api(() => json(200, body));

    await expect(relay.read(SESSION, ID)).rejects.toMatchObject({
      code: "unexpected",
    });
  });
});

describe("the in-memory relay follows the server's rules", () => {
  let clock: number;
  let relay: FakePairingRelay;

  beforeEach(() => {
    localStorage.clear();
    clock = Date.parse("2026-11-25T10:00:00Z");
    relay = new FakePairingRelay(localStorage, () => clock);
  });

  it("runs each step once and in order, and only the claiming device finishes", async () => {
    const approver = await testIdentity("d0000000-0000-4000-8000-000000000001");
    const another = await testIdentity("d0000000-0000-4000-8000-000000000002");
    const started = await relay.start(SESSION, START);
    expect(started.status).toBe("pending");
    expect(started.expiresAt).toBe("2026-11-25T10:05:00.000Z");
    expect(await relay.openRequest(SESSION)).toEqual(started);

    expect(await relay.reveal(SESSION, started.id, "ag==")).toBeUndefined();
    expect(
      await relay.approve(SESSION, approver, started.id, "dw=="),
    ).toBeUndefined();

    expect(
      (await relay.claim(SESSION, approver, started.id, "YQ=="))?.status,
    ).toBe("claimed");
    expect(
      await relay.claim(SESSION, another, started.id, "Yg=="),
    ).toBeUndefined();
    expect(await relay.openRequest(SESSION)).toBeUndefined();

    expect((await relay.reveal(SESSION, started.id, "ag=="))?.status).toBe(
      "revealed",
    );
    expect(await relay.reveal(SESSION, started.id, "eA==")).toBeUndefined();
    expect(
      await relay.approve(SESSION, another, started.id, "dw=="),
    ).toBeUndefined();
    await relay.reject(SESSION, another, started.id);

    const approved = await relay.approve(SESSION, approver, started.id, "dw==");
    expect(approved).toMatchObject({
      status: "approved",
      approverNonce: "YQ==",
      joinerNonce: "ag==",
      wrappedKey: "dw==",
    });
    expect(
      await relay.approve(SESSION, approver, started.id, "eA=="),
    ).toBeUndefined();
    await relay.reject(SESSION, approver, started.id);
    expect((await relay.read(SESSION, started.id))?.status).toBe("approved");
  });

  it("lets the claiming device reject, after which nothing more happens", async () => {
    const approver = await testIdentity();
    const started = await relay.start(SESSION, START);
    await relay.claim(SESSION, approver, started.id, "YQ==");

    await relay.reject(SESSION, approver, started.id);

    expect((await relay.read(SESSION, started.id))?.status).toBe("rejected");
    expect(await relay.reveal(SESSION, started.id, "ag==")).toBeUndefined();
  });

  it("expires a request after five minutes and then gives up no wrapped key", async () => {
    const approver = await testIdentity();
    const started = await relay.start(SESSION, START);
    await relay.claim(SESSION, approver, started.id, "YQ==");
    await relay.reveal(SESSION, started.id, "ag==");
    clock += 5 * 60 * 1_000 - 1;
    await relay.approve(SESSION, approver, started.id, "dw==");
    expect((await relay.read(SESSION, started.id))?.wrappedKey).toBe("dw==");

    clock += 1;

    expect(await relay.read(SESSION, started.id)).toMatchObject({
      status: "expired",
      wrappedKey: undefined,
    });
    expect(
      await relay.claim(SESSION, approver, started.id, "YQ=="),
    ).toBeUndefined();
  });

  it("a new request ends the account's earlier open one, and nobody else's", async () => {
    const mine = await relay.start(SESSION, START);
    const theirs = await relay.start(OTHER, START);

    const newer = await relay.start(SESSION, START);

    expect((await relay.read(SESSION, mine.id))?.status).toBe("expired");
    expect((await relay.openRequest(SESSION))?.id).toBe(newer.id);
    expect((await relay.openRequest(OTHER))?.id).toBe(theirs.id);
  });

  it("keeps accounts apart", async () => {
    const approver = await testIdentity();
    const started = await relay.start(SESSION, START);

    expect(await relay.read(OTHER, started.id)).toBeUndefined();
    expect(
      await relay.claim(OTHER, approver, started.id, "YQ=="),
    ).toBeUndefined();
    expect(await relay.read(SESSION, "unknown")).toBeUndefined();
    expect((await relay.read(SESSION, started.id))?.status).toBe("pending");
  });

  it("stores under a name that marks it as fake, and uses the real clock by default", async () => {
    const before = Date.now();

    const started = await new FakePairingRelay().start(SESSION, START);

    expect(FAKE_PAIRING_STORAGE_KEY).toContain("warmly.fake.");
    expect(localStorage.getItem(FAKE_PAIRING_STORAGE_KEY)).toContain(
      started.id,
    );
    expect(Date.parse(started.expiresAt)).toBeGreaterThanOrEqual(
      before + 5 * 60 * 1_000,
    );
  });
});
