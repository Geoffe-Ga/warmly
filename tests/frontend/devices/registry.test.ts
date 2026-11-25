import { beforeEach, describe, expect, it } from "vitest";

import { ApiClient } from "../../../src/api/client";
import type { AuthSession } from "../../../src/auth/auth-client";
import { utf8 } from "../../../src/crypto/encoding";
import { ApiDeviceRegistry } from "../../../src/devices/registry";
import { signingMessage } from "../../../src/devices/signing";
import {
  FAKE_DEVICES_STORAGE_KEY,
  FakeDeviceRegistry,
} from "../../../src/testing/fake-device-registry";
import { SESSION, json, server, testIdentity, type Call } from "./helpers";

const OTHER: AuthSession = {
  userId: "0a1b2c3d-0000-4000-8000-00000000000b",
  accessToken: "synthetic-access-token",
};
const REGISTRATION = {
  nameCiphertext: "bmFtZQ==",
  enrollmentProof: "cHJvb2Y=",
};
const WIRE_DEVICE = {
  id: "d0000000-0000-4000-8000-00000000000a",
  name_ciphertext: "bmFtZQ==",
  created_at: "2026-11-25T10:00:00Z",
  last_sync_at: null,
  revoked_at: null,
  is_current: true,
};

function registry(respond: (call: Call) => Response): {
  calls: Call[];
  registry: ApiDeviceRegistry;
} {
  const api = server(respond);
  return {
    calls: api.calls,
    registry: new ApiDeviceRegistry(
      new ApiClient("", api.fetch, () => 1_795_651_200_000),
    ),
  };
}

async function isSignedBy(
  call: Call | undefined,
  identity: Awaited<ReturnType<typeof testIdentity>>,
  method: string,
  target: string,
): Promise<boolean> {
  const message = await signingMessage({
    method,
    target,
    body: utf8(call?.body ?? ""),
    deviceId: identity.deviceId,
    timestamp: 1_795_651_200,
    nonce: call?.headers["Warmly-Nonce"] ?? "",
  });
  return identity.verify(message, call?.headers["Warmly-Signature"] ?? "");
}

describe("the device register on the Warmly API (DEV-002, DEV-003)", () => {
  it("registers with the ID, public key, encrypted name and proof, signed by the new key", async () => {
    const identity = await testIdentity();
    const api = registry(() => json(201, WIRE_DEVICE));

    expect(await api.registry.register(SESSION, identity, REGISTRATION)).toBe(
      true,
    );

    const call = api.calls[0];
    expect(call?.init.method).toBe("POST");
    expect(call?.url).toBe("/v1/devices");
    expect(JSON.parse(call?.body ?? "")).toEqual({
      device_id: identity.deviceId,
      public_key: identity.publicKey,
      name_ciphertext: "bmFtZQ==",
      enrollment_proof: "cHJvb2Y=",
    });
    expect(await isSignedBy(call, identity, "POST", "/v1/devices")).toBe(true);
  });

  it("reports a device that was already registered as false, not as a failure", async () => {
    const api = registry(() =>
      json(409, { code: "device.already_registered" }),
    );

    expect(
      await api.registry.register(SESSION, await testIdentity(), REGISTRATION),
    ).toBe(false);
  });

  it.each([
    [
      "an account with no keys yet",
      () => json(409, { code: "device.account_not_ready" }),
    ],
    ["a conflict with no code", () => json(409, {})],
    ["a conflict with no JSON", () => new Response("no", { status: 409 })],
    ["a null conflict body", () => json(409, null)],
    ["a refused proof", () => json(403, { code: "device.not_authorized" })],
    ["a server error", () => json(500, {})],
  ])("fails to register on %s", async (_name, respond) => {
    const api = registry(respond);

    await expect(
      api.registry.register(SESSION, await testIdentity(), REGISTRATION),
    ).rejects.toMatchObject({ code: "unexpected" });
  });

  it("lists devices with a signed request and reads each field", async () => {
    const identity = await testIdentity();
    const api = registry(() =>
      json(200, {
        devices: [
          WIRE_DEVICE,
          {
            ...WIRE_DEVICE,
            id: "d0000000-0000-4000-8000-00000000000b",
            last_sync_at: "2026-11-25T11:00:00Z",
            revoked_at: "2026-11-25T12:00:00Z",
            is_current: false,
          },
        ],
      }),
    );

    const devices = await api.registry.list(SESSION, identity);

    expect(devices).toEqual([
      {
        id: "d0000000-0000-4000-8000-00000000000a",
        nameCiphertext: "bmFtZQ==",
        createdAt: "2026-11-25T10:00:00Z",
        lastSyncAt: undefined,
        revoked: false,
        isCurrent: true,
      },
      {
        id: "d0000000-0000-4000-8000-00000000000b",
        nameCiphertext: "bmFtZQ==",
        createdAt: "2026-11-25T10:00:00Z",
        lastSyncAt: "2026-11-25T11:00:00Z",
        revoked: true,
        isCurrent: false,
      },
    ]);
    expect(api.calls[0]?.init.method).toBe("GET");
    expect(await isSignedBy(api.calls[0], identity, "GET", "/v1/devices")).toBe(
      true,
    );
  });

  it("reads a device whose optional fields are absent", async () => {
    const api = registry(() =>
      json(200, {
        devices: [
          {
            id: "d",
            name_ciphertext: "bmFtZQ==",
            created_at: "2026-11-25T10:00:00Z",
            is_current: false,
          },
        ],
      }),
    );

    expect(await api.registry.list(SESSION, await testIdentity())).toEqual([
      {
        id: "d",
        nameCiphertext: "bmFtZQ==",
        createdAt: "2026-11-25T10:00:00Z",
        lastSyncAt: undefined,
        revoked: false,
        isCurrent: false,
      },
    ]);
  });

  it.each([
    ["a server error", () => json(500, { devices: [] })],
    ["a body with no list", () => json(200, {})],
    ["a null body", () => json(200, null)],
    ["a list that is not a list", () => json(200, { devices: "none" })],
    ["a device that is not an object", () => json(200, { devices: [null] })],
    [
      "a device with no ID",
      () => json(200, { devices: [{ ...WIRE_DEVICE, id: 7 }] }),
    ],
    [
      "a device with no name",
      () => json(200, { devices: [{ ...WIRE_DEVICE, name_ciphertext: null }] }),
    ],
    [
      "a device with no date",
      () => json(200, { devices: [{ ...WIRE_DEVICE, created_at: 1 }] }),
    ],
    [
      "a device with no current marker",
      () => json(200, { devices: [{ ...WIRE_DEVICE, is_current: "yes" }] }),
    ],
  ])("refuses %s when listing", async (_name, respond) => {
    const api = registry(respond);

    await expect(
      api.registry.list(SESSION, await testIdentity()),
    ).rejects.toMatchObject({ code: "unexpected" });
  });

  it("renames with only the new encrypted name, signed", async () => {
    const identity = await testIdentity();
    const api = registry(() => json(200, WIRE_DEVICE));

    expect(
      await api.registry.rename(SESSION, identity, WIRE_DEVICE.id, "bmV3"),
    ).toBe(true);

    const call = api.calls[0];
    expect(call?.init.method).toBe("PATCH");
    expect(call?.url).toBe(`/v1/devices/${WIRE_DEVICE.id}`);
    expect(JSON.parse(call?.body ?? "")).toEqual({ name_ciphertext: "bmV3" });
    expect(
      await isSignedBy(
        call,
        identity,
        "PATCH",
        `/v1/devices/${WIRE_DEVICE.id}`,
      ),
    ).toBe(true);
  });

  it("escapes the device ID, so it cannot change the path", async () => {
    const api = registry(() => json(404, {}));

    await api.registry.rename(SESSION, await testIdentity(), "../x?y", "bmV3");

    expect(api.calls[0]?.url).toBe("/v1/devices/..%2Fx%3Fy");
  });

  it("reports a device that is not the account's as false (DEV-010)", async () => {
    const api = registry(() => json(404, { code: "device.not_found" }));

    expect(
      await api.registry.rename(SESSION, await testIdentity(), "d", "bmV3"),
    ).toBe(false);
  });

  it("fails to rename on a server error", async () => {
    const api = registry(() => json(500, {}));

    await expect(
      api.registry.rename(SESSION, await testIdentity(), "d", "bmV3"),
    ).rejects.toMatchObject({ code: "unexpected" });
  });
});

describe("revoking through the Warmly API (DEV-003, AC-20)", () => {
  it("sends a signed request with no body", async () => {
    const identity = await testIdentity();
    const api = registry(() => json(200, { ...WIRE_DEVICE, revoked_at: "x" }));

    expect(await api.registry.revoke(SESSION, identity, WIRE_DEVICE.id)).toBe(
      true,
    );

    const call = api.calls[0];
    expect(call?.init.method).toBe("POST");
    expect(call?.url).toBe(`/v1/devices/${WIRE_DEVICE.id}/revoke`);
    expect(call?.body).toBe("");
    expect(
      await isSignedBy(
        call,
        identity,
        "POST",
        `/v1/devices/${WIRE_DEVICE.id}/revoke`,
      ),
    ).toBe(true);
  });

  it("escapes the device ID", async () => {
    const api = registry(() => json(404, {}));

    await api.registry.revoke(SESSION, await testIdentity(), "../x?y");

    expect(api.calls[0]?.url).toBe("/v1/devices/..%2Fx%3Fy/revoke");
  });

  it.each([
    [404, { code: "device.not_found" }, false],
    [200, WIRE_DEVICE, true],
  ])("reports %i as %j", async (status, body, expected) => {
    const api = registry(() => json(status, body));

    expect(await api.registry.revoke(SESSION, await testIdentity(), "d")).toBe(
      expected,
    );
  });

  it.each([
    [403, "reauthentication_required"],
    [500, "unexpected"],
  ])("fails on %i with %s", async (status, code) => {
    const api = registry(() => json(status, {}));

    await expect(
      api.registry.revoke(SESSION, await testIdentity(), "d"),
    ).rejects.toMatchObject({ code });
  });
});

describe("the in-memory register follows the same ownership rules (DEV-010)", () => {
  const NOW = new Date("2026-11-25T10:00:00Z");
  let fake: FakeDeviceRegistry;

  beforeEach(() => {
    localStorage.clear();
    fake = new FakeDeviceRegistry(localStorage, () => NOW);
  });

  it("registers a device once and lists it as the current one", async () => {
    const identity = await testIdentity();

    expect(await fake.register(SESSION, identity, REGISTRATION)).toBe(true);
    expect(await fake.register(SESSION, identity, REGISTRATION)).toBe(false);

    expect(await fake.list(SESSION, identity)).toEqual([
      {
        id: identity.deviceId,
        nameCiphertext: "bmFtZQ==",
        createdAt: "2026-11-25T10:00:00.000Z",
        lastSyncAt: undefined,
        revoked: false,
        isCurrent: true,
      },
    ]);
  });

  it("marks only the asking device as current", async () => {
    const first = await testIdentity("d0000000-0000-4000-8000-000000000001");
    const second = await testIdentity("d0000000-0000-4000-8000-000000000002");
    await fake.register(SESSION, first, REGISTRATION);
    await fake.register(SESSION, second, REGISTRATION);

    const seen = await fake.list(SESSION, second);

    expect(seen.map((device) => [device.id, device.isCurrent])).toEqual([
      [first.deviceId, false],
      [second.deviceId, true],
    ]);
  });

  it("never shows or renames another account's device", async () => {
    const mine = await testIdentity("d0000000-0000-4000-8000-000000000001");
    const theirs = await testIdentity("d0000000-0000-4000-8000-000000000002");
    await fake.register(SESSION, mine, REGISTRATION);
    await fake.register(OTHER, theirs, REGISTRATION);

    expect((await fake.list(SESSION, mine)).map((device) => device.id)).toEqual(
      [mine.deviceId],
    );
    expect(await fake.rename(SESSION, mine, theirs.deviceId, "bmV3")).toBe(
      false,
    );
    expect((await fake.list(OTHER, theirs))[0]?.nameCiphertext).toBe(
      "bmFtZQ==",
    );
  });

  it("refuses a device ID that another account registered", async () => {
    const identity = await testIdentity();
    await fake.register(OTHER, identity, REGISTRATION);

    expect(await fake.register(SESSION, identity, REGISTRATION)).toBe(false);
    expect(await fake.list(SESSION, identity)).toEqual([]);
  });

  it("renames a device and keeps the change across instances, like a server", async () => {
    const identity = await testIdentity();
    await fake.register(SESSION, identity, REGISTRATION);

    expect(
      await fake.rename(SESSION, identity, identity.deviceId, "bmV3"),
    ).toBe(true);

    const reloaded = new FakeDeviceRegistry();
    expect((await reloaded.list(SESSION, identity))[0]?.nameCiphertext).toBe(
      "bmV3",
    );
  });

  it("refuses a revoked device from then on, tells the app, and never lets its ID back", async () => {
    let reports = 0;
    const reporting = new FakeDeviceRegistry(
      localStorage,
      () => NOW,
      () => {
        reports += 1;
      },
    );
    const first = await testIdentity("d0000000-0000-4000-8000-000000000001");
    const second = await testIdentity("d0000000-0000-4000-8000-000000000002");
    await reporting.register(SESSION, first, REGISTRATION);
    await reporting.register(SESSION, second, REGISTRATION);

    expect(await reporting.revoke(SESSION, first, second.deviceId)).toBe(true);

    expect(
      (await reporting.list(SESSION, first)).map((device) => device.revoked),
    ).toEqual([false, true]);
    expect(reports).toBe(0);
    for (const attempt of [
      reporting.list(SESSION, second),
      reporting.rename(SESSION, second, second.deviceId, "bmV3"),
      reporting.revoke(SESSION, second, first.deviceId),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "device_revoked" });
    }
    expect(reports).toBe(3);
    expect(await reporting.register(SESSION, second, REGISTRATION)).toBe(false);
    expect((await reporting.list(SESSION, first))[0]?.revoked).toBe(false);
  });

  it("never revokes another account's device", async () => {
    const mine = await testIdentity("d0000000-0000-4000-8000-000000000001");
    const theirs = await testIdentity("d0000000-0000-4000-8000-000000000002");
    await fake.register(SESSION, mine, REGISTRATION);
    await fake.register(OTHER, theirs, REGISTRATION);

    expect(await fake.revoke(SESSION, mine, theirs.deviceId)).toBe(false);
    expect(await fake.revoke(SESSION, mine, "unknown")).toBe(false);
    expect((await fake.list(OTHER, theirs))[0]?.revoked).toBe(false);
  });

  it("stores only ciphertext and identifiers, under a name that marks it as fake", async () => {
    const identity = await testIdentity();
    await fake.register(SESSION, identity, REGISTRATION);

    expect(FAKE_DEVICES_STORAGE_KEY).toContain("warmly.fake.");
    expect(localStorage.getItem(FAKE_DEVICES_STORAGE_KEY)).toBe(
      JSON.stringify([
        [
          SESSION.userId,
          identity.deviceId,
          "bmFtZQ==",
          "2026-11-25T10:00:00.000Z",
        ],
      ]),
    );
  });

  it("uses the real clock by default", async () => {
    const identity = await testIdentity();
    const before = Date.now();

    await new FakeDeviceRegistry().register(SESSION, identity, REGISTRATION);

    const created = Date.parse(
      (await fake.list(SESSION, identity))[0]?.createdAt ?? "",
    );
    expect(created).toBeGreaterThanOrEqual(before);
    expect(created).toBeLessThanOrEqual(Date.now());
  });
});
