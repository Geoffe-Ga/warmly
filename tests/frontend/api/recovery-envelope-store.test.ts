import { beforeEach, describe, expect, it } from "vitest";

import { ApiRecoveryEnvelopeStore } from "../../../src/api/recovery-envelope-store";
import type { AuthSession } from "../../../src/auth/auth-client";
import { toBase64 } from "../../../src/crypto/encoding";
import { FakeRecoveryEnvelopeStore } from "../../../src/testing/fake-recovery-envelope-store";

const SESSION: AuthSession = {
  userId: "0a1b2c3d-0000-4000-8000-00000000000a",
  accessToken: "synthetic-access-token",
};
const OTHER: AuthSession = {
  userId: "0a1b2c3d-0000-4000-8000-00000000000b",
  accessToken: "synthetic-access-token",
};
const ENVELOPE = new Uint8Array([1, 2, 3, 4]);

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function server(respond: () => Response | Promise<Response>): {
  calls: Call[];
  fetch: typeof fetch;
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (input, init = {}) => {
      calls.push({ url: String(input), init });
      return Promise.resolve().then(respond);
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("the recovery envelope on the Warmly API (SEC-003)", () => {
  it("reads the envelope with the access token and no cookies", async () => {
    const api = server(() =>
      json(200, { version: 3, format_version: 1, wrapped_key: "AQIDBA==" }),
    );
    const store = new ApiRecoveryEnvelopeStore(
      "https://api.example/",
      api.fetch,
    );

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

    await new ApiRecoveryEnvelopeStore("", api.fetch).read(SESSION);

    expect(api.calls[0]?.url).toBe("/v1/recovery-envelope");
  });

  it("reports an account with no envelope as undefined", async () => {
    const api = server(() => json(404, { code: "recovery.not_found" }));

    expect(
      await new ApiRecoveryEnvelopeStore("", api.fetch).read(SESSION),
    ).toBeUndefined();
  });

  it("sends only the wrapped key, the format and the expected version", async () => {
    const api = server(() =>
      json(200, { version: 1, format_version: 1, wrapped_key: "AQIDBA==" }),
    );
    const store = new ApiRecoveryEnvelopeStore("", api.fetch);

    expect(await store.write(SESSION, 0, ENVELOPE)).toBe(true);

    expect(api.calls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(String(api.calls[0]?.init.body))).toEqual({
      expected_version: 0,
      format_version: 1,
      wrapped_key: "AQIDBA==",
    });
    expect(api.calls[0]?.init.headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });

  it("reports a version conflict as false", async () => {
    const api = server(() => json(409, { code: "recovery.version_conflict" }));

    expect(
      await new ApiRecoveryEnvelopeStore("", api.fetch).write(
        SESSION,
        2,
        ENVELOPE,
      ),
    ).toBe(false);
  });

  it.each(["read", "write"] as const)(
    "reports being offline on %s",
    async (operation) => {
      const store = new ApiRecoveryEnvelopeStore("", () =>
        Promise.reject(new TypeError("Failed to fetch")),
      );
      const attempt =
        operation === "read"
          ? store.read(SESSION)
          : store.write(SESSION, 0, ENVELOPE);

      await expect(attempt).rejects.toMatchObject({ code: "offline" });
    },
  );

  it.each(["read", "write"] as const)(
    "reports a refused token on %s as signed out",
    async (operation) => {
      const api = server(() => json(401, { code: "auth.invalid_token" }));
      const store = new ApiRecoveryEnvelopeStore("", api.fetch);
      const attempt =
        operation === "read"
          ? store.read(SESSION)
          : store.write(SESSION, 0, ENVELOPE);

      await expect(attempt).rejects.toMatchObject({ code: "signed_out" });
    },
  );

  it.each([
    ["a server error", () => json(500, { code: "server.internal_error" })],
    ["a body that is not an envelope", () => json(200, { version: "1" })],
    ["a body with no wrapped key", () => json(200, { version: 1 })],
    ["a null body", () => json(200, null)],
  ])("refuses %s when reading, without detail", async (_name, respond) => {
    const store = new ApiRecoveryEnvelopeStore("", server(respond).fetch);

    await expect(store.read(SESSION)).rejects.toThrow(
      "The recovery envelope could not be read",
    );
  });

  it("refuses an unexpected status when writing", async () => {
    const store = new ApiRecoveryEnvelopeStore(
      "",
      server(() => json(503, {})).fetch,
    );

    await expect(store.write(SESSION, 0, ENVELOPE)).rejects.toThrow(
      "The recovery envelope could not be saved",
    );
  });

  it("never puts the access token in the URL", async () => {
    const api = server(() => json(404, {}));

    await new ApiRecoveryEnvelopeStore("", api.fetch).read(SESSION);

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
    expect(await store.write(SESSION, 1, ENVELOPE)).toBe(false);
    expect(await store.write(SESSION, 0, ENVELOPE)).toBe(true);
    expect(await store.write(SESSION, 0, ENVELOPE)).toBe(false);
    expect(await store.write(SESSION, 1, new Uint8Array([9]))).toBe(true);
    expect(await store.write(SESSION, 1, ENVELOPE)).toBe(false);

    const stored = await store.read(SESSION);
    expect(stored?.version).toBe(2);
    expect([...(stored?.envelope ?? [])]).toEqual([9]);
  });

  it("keeps accounts apart and survives a reload", async () => {
    await store.write(SESSION, 0, ENVELOPE);
    await store.write(OTHER, 0, new Uint8Array([7]));

    const reloaded = new FakeRecoveryEnvelopeStore();

    expect([...((await reloaded.read(SESSION))?.envelope ?? [])]).toEqual([
      1, 2, 3, 4,
    ]);
    expect([...((await reloaded.read(OTHER))?.envelope ?? [])]).toEqual([7]);
  });
});
