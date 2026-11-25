import { beforeEach, describe, expect, it } from "vitest";

import { ApiClient } from "../../../src/api/client";
import {
  ApiRecoveryEnvelopeStore,
  type RecoveryEnvelopeWrite,
} from "../../../src/api/recovery-envelope-store";
import type { AuthSession } from "../../../src/auth/auth-client";
import { toBase64, utf8 } from "../../../src/crypto/encoding";
import { VaultError } from "../../../src/crypto/key-vault";
import type { DeviceIdentityStore } from "../../../src/devices/identity";
import { signingMessage } from "../../../src/devices/signing";
import { FakeRecoveryEnvelopeStore } from "../../../src/testing/fake-recovery-envelope-store";
import {
  MemoryIdentityStore,
  json,
  server,
  type TestIdentity,
} from "../devices/helpers";

const SESSION: AuthSession = {
  userId: "0a1b2c3d-0000-4000-8000-00000000000a",
  accessToken: "synthetic-access-token",
};
const OTHER: AuthSession = {
  userId: "0a1b2c3d-0000-4000-8000-00000000000b",
  accessToken: "synthetic-access-token",
};
const ENVELOPE = new Uint8Array([1, 2, 3, 4]);

const VERIFIER = new Uint8Array(32).fill(5);

function change(
  expectedVersion: number,
  envelope: Uint8Array<ArrayBuffer> = ENVELOPE,
  formatVersion = 1,
): RecoveryEnvelopeWrite {
  return {
    expectedVersion,
    envelope,
    formatVersion,
    enrollmentVerifier: VERIFIER,
  };
}

function apiStore(
  baseUrl: string,
  fetchFn: typeof fetch,
  identities: DeviceIdentityStore = new MemoryIdentityStore(),
): ApiRecoveryEnvelopeStore {
  return new ApiRecoveryEnvelopeStore(
    new ApiClient(baseUrl, fetchFn, () => 1_795_651_200_000),
    identities,
  );
}

describe("the recovery envelope on the Warmly API (SEC-003)", () => {
  it("reads the envelope with the access token and no cookies", async () => {
    const api = server(() =>
      json(200, { version: 3, format_version: 1, wrapped_key: "AQIDBA==" }),
    );
    const store = apiStore("https://api.example/", api.fetch);

    const stored = await store.read(SESSION);

    expect(stored?.version).toBe(3);
    expect(toBase64(stored?.envelope ?? new Uint8Array())).toBe("AQIDBA==");
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url).toBe("https://api.example/v1/recovery-envelope");
    expect(api.calls[0]?.init.credentials).toBe("omit");
    expect(api.calls[0]?.init.cache).toBe("no-store");
    expect(api.calls[0]?.init.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer synthetic-access-token",
    });
  });

  it("uses the app's own origin when no API origin is configured", async () => {
    const api = server(() => json(404, {}));

    await apiStore("", api.fetch).read(SESSION);

    expect(api.calls[0]?.url).toBe("/v1/recovery-envelope");
  });

  it("reports an account with no envelope as undefined", async () => {
    const api = server(() => json(404, { code: "recovery.not_found" }));

    expect(await apiStore("", api.fetch).read(SESSION)).toBeUndefined();
  });

  it("creates with the wrapped key, the format, the expected version and the enrollment verifier", async () => {
    const api = server(() =>
      json(200, { version: 1, format_version: 1, wrapped_key: "AQIDBA==" }),
    );
    const store = apiStore("", api.fetch);

    expect(await store.write(SESSION, change(0))).toBe(true);

    expect(api.calls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(api.calls[0]?.body ?? "")).toEqual({
      expected_version: 0,
      format_version: 1,
      wrapped_key: "AQIDBA==",
      device_enrollment_verifier: toBase64(VERIFIER),
    });
    expect(api.calls[0]?.init.headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });

  it("sends the format version it is given, not one guessed from the bytes", async () => {
    const api = server(() =>
      json(200, { version: 1, format_version: 2, wrapped_key: "AQIDBA==" }),
    );

    await apiStore("", api.fetch).write(SESSION, change(0, ENVELOPE, 2));

    expect(JSON.parse(api.calls[0]?.body ?? "")).toMatchObject({
      format_version: 2,
    });
  });

  it("creates without a device signature, because no device can register before the envelope exists", async () => {
    const identities = new MemoryIdentityStore();
    await identities.getOrCreate(SESSION.userId);
    const api = server(() => json(200, {}));

    await apiStore("", api.fetch, identities).write(SESSION, change(0));

    expect(api.calls[0]?.headers["Warmly-Signature"]).toBeUndefined();
    expect(api.calls[0]?.headers["Warmly-Device"]).toBeUndefined();
  });

  it("replaces with a request signed by this device, and without the verifier (SEC-006)", async () => {
    const identities = new MemoryIdentityStore();
    const identity = await identities.getOrCreate(SESSION.userId);
    const api = server(() => json(200, {}));

    expect(
      await apiStore("", api.fetch, identities).write(SESSION, change(3)),
    ).toBe(true);

    const call = api.calls[0];
    expect(JSON.parse(call?.body ?? "")).toEqual({
      expected_version: 3,
      format_version: 1,
      wrapped_key: "AQIDBA==",
    });
    expect(call?.headers["Warmly-Device"]).toBe(identity.deviceId);
    const message = await signingMessage({
      method: "PUT",
      target: "/v1/recovery-envelope",
      body: utf8(call?.body ?? ""),
      deviceId: identity.deviceId,
      timestamp: 1_795_651_200,
      nonce: call?.headers["Warmly-Nonce"] ?? "",
    });
    expect(
      await (identity as TestIdentity).verify(
        message,
        call?.headers["Warmly-Signature"] ?? "",
      ),
    ).toBe(true);
  });

  it("says the device is not authorised when a replacement is refused for its signature", async () => {
    const api = server(() => json(401, { code: "device.missing_signature" }));

    await expect(
      apiStore("", api.fetch).write(SESSION, change(1)),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "device_not_authorized",
    });
    expect(api.calls[0]?.headers["Warmly-Signature"]).toBeUndefined();
  });

  it("reports a version conflict as false", async () => {
    const api = server(() => json(409, { code: "recovery.version_conflict" }));

    expect(await apiStore("", api.fetch).write(SESSION, change(2))).toBe(false);
  });

  it.each(["read", "write"] as const)(
    "reports being offline on %s",
    async (operation) => {
      const store = apiStore("", () =>
        Promise.reject(new TypeError("Failed to fetch")),
      );
      await expect(
        operation === "read"
          ? store.read(SESSION)
          : store.write(SESSION, change(0)),
      ).rejects.toBeInstanceOf(VaultError);
      const attempt =
        operation === "read"
          ? store.read(SESSION)
          : store.write(SESSION, change(0));

      await expect(attempt).rejects.toMatchObject({ code: "offline" });
    },
  );

  it.each(["read", "write"] as const)(
    "reports a refused token on %s as signed out",
    async (operation) => {
      const api = server(() => json(401, { code: "auth.invalid_token" }));
      const store = apiStore("", api.fetch);
      const attempt =
        operation === "read"
          ? store.read(SESSION)
          : store.write(SESSION, change(0));

      await expect(attempt).rejects.toMatchObject({ code: "signed_out" });
    },
  );

  it.each([
    ["a server error", () => json(500, { code: "server.internal_error" })],
    ["a body that is not an envelope", () => json(200, { version: "1" })],
    ["a body with no wrapped key", () => json(200, { version: 1 })],
    ["a null body", () => json(200, null)],
  ])("refuses %s when reading, without detail", async (_name, respond) => {
    const store = apiStore("", server(respond).fetch);

    await expect(store.read(SESSION)).rejects.toThrow(
      "The recovery envelope could not be read",
    );
  });

  it("refuses an unexpected status when writing", async () => {
    const store = apiStore("", server(() => json(503, {})).fetch);

    await expect(store.write(SESSION, change(0))).rejects.toThrow(
      "The recovery envelope could not be saved",
    );
  });

  it("never puts the access token in the URL", async () => {
    const api = server(() => json(404, {}));

    await apiStore("", api.fetch).read(SESSION);

    expect(api.calls[0]?.url).not.toContain(SESSION.accessToken);
  });
});

describe("the in-memory stand-in follows the same rules", () => {
  let store: FakeRecoveryEnvelopeStore;

  beforeEach(() => {
    localStorage.clear();
    store = new FakeRecoveryEnvelopeStore();
  });

  it("creates once, then replaces only the expected version", async () => {
    expect(await store.read(SESSION)).toBeUndefined();
    expect(await store.write(SESSION, change(1))).toBe(false);
    expect(await store.write(SESSION, change(0))).toBe(true);
    expect(await store.write(SESSION, change(0))).toBe(false);
    expect(await store.write(SESSION, change(1, new Uint8Array([9])))).toBe(
      true,
    );
    expect(await store.write(SESSION, change(1))).toBe(false);

    const stored = await store.read(SESSION);
    expect(stored?.version).toBe(2);
    expect([...(stored?.envelope ?? [])]).toEqual([9]);
  });

  it("keeps accounts apart and survives a reload", async () => {
    await store.write(SESSION, change(0));
    await store.write(OTHER, change(0, new Uint8Array([7])));

    const reloaded = new FakeRecoveryEnvelopeStore();

    expect([...((await reloaded.read(SESSION))?.envelope ?? [])]).toEqual([
      1, 2, 3, 4,
    ]);
    expect([...((await reloaded.read(OTHER))?.envelope ?? [])]).toEqual([7]);
  });
});
