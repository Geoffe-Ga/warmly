import { describe, expect, it } from "vitest";

import { ApiClient, ApiError } from "../../../src/api/client";
import { utf8 } from "../../../src/crypto/encoding";
import { signingMessage } from "../../../src/devices/signing";
import { SESSION, json, server, testIdentity } from "../devices/helpers";

const NOW = 1_795_651_200_500;

describe("the API client signs requests with the device key (D-06, SEC-006)", () => {
  it("sends the device ID, a timestamp, a nonce and a signature over the request", async () => {
    const identity = await testIdentity();
    const api = server(() => json(200, {}));
    const client = new ApiClient("https://api.example/", api.fetch, () => NOW);

    await client.send(SESSION, {
      method: "POST",
      path: "/v1/sync/operations?dry=1",
      body: { operations: [] },
      signedBy: identity,
    });

    const call = api.calls[0];
    expect(call?.url).toBe("https://api.example/v1/sync/operations?dry=1");
    expect(call?.headers["Warmly-Device"]).toBe(identity.deviceId);
    expect(call?.headers["Warmly-Timestamp"]).toBe("1795651200");
    expect(call?.headers["Warmly-Nonce"]).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const message = await signingMessage({
      method: "POST",
      target: "/v1/sync/operations?dry=1",
      body: utf8('{"operations":[]}'),
      deviceId: identity.deviceId,
      timestamp: 1_795_651_200,
      nonce: call?.headers["Warmly-Nonce"] ?? "",
    });
    expect(
      await identity.verify(message, call?.headers["Warmly-Signature"] ?? ""),
    ).toBe(true);
  });

  it("signs exactly the bytes it sends", async () => {
    const identity = await testIdentity();
    const api = server(() => json(200, {}));

    await new ApiClient("", api.fetch, () => NOW).send(SESSION, {
      method: "PATCH",
      path: "/v1/devices/x",
      body: { name_ciphertext: "4pyT", note: "✓" },
      signedBy: identity,
    });

    const call = api.calls[0];
    const message = await signingMessage({
      method: "PATCH",
      target: "/v1/devices/x",
      body: utf8(call?.body ?? ""),
      deviceId: identity.deviceId,
      timestamp: 1_795_651_200,
      nonce: call?.headers["Warmly-Nonce"] ?? "",
    });
    expect(call?.body).toBe('{"name_ciphertext":"4pyT","note":"✓"}');
    expect(
      await identity.verify(message, call?.headers["Warmly-Signature"] ?? ""),
    ).toBe(true);
  });

  it("uses a new nonce for every request, so none can be replayed", async () => {
    const identity = await testIdentity();
    const api = server(() => json(200, {}));
    const client = new ApiClient("", api.fetch, () => NOW);
    const request = {
      method: "GET",
      path: "/v1/devices",
      signedBy: identity,
    } as const;

    await client.send(SESSION, request);
    await client.send(SESSION, request);

    expect(api.calls[0]?.headers["Warmly-Nonce"]).not.toBe(
      api.calls[1]?.headers["Warmly-Nonce"],
    );
  });

  it("signs a request with no body over the empty body, and sends none", async () => {
    const identity = await testIdentity();
    const api = server(() => json(200, {}));

    await new ApiClient("", api.fetch, () => NOW).send(SESSION, {
      method: "GET",
      path: "/v1/devices",
      signedBy: identity,
    });

    const call = api.calls[0];
    expect(call?.init.body).toBeUndefined();
    expect(call?.headers["Content-Type"]).toBeUndefined();
    const message = await signingMessage({
      method: "GET",
      target: "/v1/devices",
      body: new Uint8Array(),
      deviceId: identity.deviceId,
      timestamp: 1_795_651_200,
      nonce: call?.headers["Warmly-Nonce"] ?? "",
    });
    expect(
      await identity.verify(message, call?.headers["Warmly-Signature"] ?? ""),
    ).toBe(true);
  });

  it("sends no device headers for a request made before the device is registered", async () => {
    const api = server(() => json(404, {}));

    const response = await new ApiClient("", api.fetch).send(SESSION, {
      method: "GET",
      path: "/v1/recovery-envelope",
      signedBy: undefined,
    });

    expect(response.status).toBe(404);
    expect(api.calls[0]?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer synthetic-access-token",
    });
  });

  it("sends the token as the only credential and never caches", async () => {
    const api = server(() => json(200, {}));

    await new ApiClient("", api.fetch).send(SESSION, {
      method: "GET",
      path: "/v1/devices",
      signedBy: undefined,
    });

    expect(api.calls[0]?.init.credentials).toBe("omit");
    expect(api.calls[0]?.init.cache).toBe("no-store");
    expect(api.calls[0]?.url).not.toContain(SESSION.accessToken);
  });

  it("sends extra fixed headers beside its own", async () => {
    const identity = await testIdentity();
    const api = server(() => json(200, {}));
    const client = new ApiClient("https://api.example/", api.fetch, () => NOW);

    await client.send(SESSION, {
      method: "GET",
      path: "/v1/sync/changes",
      signedBy: identity,
      headers: { "Warmly-Sync-Version": "1" },
    });

    expect(api.calls[0]?.headers["Warmly-Sync-Version"]).toBe("1");
    expect(api.calls[0]?.headers["Authorization"]).toBe(
      `Bearer ${SESSION.accessToken}`,
    );
    expect(api.calls[0]?.headers["Warmly-Device"]).toBe(identity.deviceId);
  });

  it.each([
    "Authorization",
    "authorization",
    "Accept",
    "Content-Type",
    "Cookie",
    "Warmly-Device",
    "warmly-timestamp",
    "Warmly-Nonce",
    "WARMLY-SIGNATURE",
  ])(
    "refuses an extra header named %s, and sends nothing (SEC-006)",
    async (name) => {
      const identity = await testIdentity();
      const api = server(() => json(200, {}));
      const client = new ApiClient(
        "https://api.example/",
        api.fetch,
        () => NOW,
      );

      await expect(
        client.send(SESSION, {
          method: "GET",
          path: "/v1/sync/changes",
          signedBy: identity,
          headers: { [name]: "forged" },
        }),
      ).rejects.toThrow(TypeError);
      expect(api.calls).toEqual([]);
    },
  );

  it("uses the real clock by default", async () => {
    const identity = await testIdentity();
    const api = server(() => json(200, {}));
    const before = Math.floor(Date.now() / 1000);

    await new ApiClient("", api.fetch).send(SESSION, {
      method: "GET",
      path: "/v1/devices",
      signedBy: identity,
    });

    const sent = Number(api.calls[0]?.headers["Warmly-Timestamp"]);
    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});

describe("the API client explains a refusal without repeating the server's text", () => {
  async function refusedWith(respond: () => Response): Promise<unknown> {
    const client = new ApiClient("", server(respond).fetch);
    return client
      .send(SESSION, {
        method: "GET",
        path: "/v1/devices",
        signedBy: undefined,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
  }

  it.each([
    ["auth.invalid_token", "signed_out"],
    ["device.missing_signature", "device_not_authorized"],
    ["device.not_authorized", "device_not_authorized"],
    ["device.stale_request", "clock_wrong"],
    ["device.revoked", "device_revoked"],
  ])("maps a 401 %s to %s", async (code, expected) => {
    const error = await refusedWith(() =>
      json(401, { code, detail: "private detail from the server" }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: expected });
    expect(String(error)).not.toContain("private detail");
  });

  it("tells the app once, centrally, when this device has been revoked (AC-20)", async () => {
    let reports = 0;
    const revoked = new ApiClient(
      "",
      server(() => json(401, { code: "device.revoked" })).fetch,
      () => NOW,
      () => {
        reports += 1;
      },
    );
    const refused = new ApiClient(
      "",
      server(() => json(401, { code: "device.not_authorized" })).fetch,
      () => NOW,
      () => {
        reports += 1;
      },
    );
    const request = {
      method: "GET",
      path: "/v1/devices",
      signedBy: undefined,
    } as const;

    await expect(refused.send(SESSION, request)).rejects.toMatchObject({
      code: "device_not_authorized",
    });
    expect(reports).toBe(0);
    await expect(revoked.send(SESSION, request)).rejects.toMatchObject({
      code: "device_revoked",
    });
    expect(reports).toBe(1);
  });

  it.each([
    ["no body", () => new Response(null, { status: 401 })],
    ["a body that is not JSON", () => new Response("<html>", { status: 401 })],
    ["a problem with no code", () => json(401, { title: "Unauthorized" })],
    ["a code that is not text", () => json(401, { code: 7 })],
    ["a null body", () => json(401, null)],
  ])("treats a 401 with %s as signed out", async (_name, respond) => {
    expect(await refusedWith(respond)).toMatchObject({ code: "signed_out" });
  });

  it("reports an unreachable server as offline", async () => {
    const client = new ApiClient("", () =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    await expect(
      client.send(SESSION, {
        method: "GET",
        path: "/v1/devices",
        signedBy: undefined,
      }),
    ).rejects.toMatchObject({ name: "ApiError", code: "offline" });
  });

  it.each([200, 404, 409, 500])(
    "hands back a %i response for the caller to interpret",
    async (status) => {
      const client = new ApiClient("", server(() => json(status, {})).fetch);

      const response = await client.send(SESSION, {
        method: "GET",
        path: "/v1/devices",
        signedBy: undefined,
      });

      expect(response.status).toBe(status);
    },
  );
});
