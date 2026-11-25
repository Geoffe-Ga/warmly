import type { AuthSession } from "../../../src/auth/auth-client";
import { fromBase64, toBase64 } from "../../../src/crypto/encoding";
import { importRootKey, type RootKey } from "../../../src/crypto/root-key";
import type {
  DeviceIdentity,
  DeviceIdentityStore,
} from "../../../src/devices/identity";

/** A synthetic session. Nothing here is real. */
export const SESSION: AuthSession = {
  userId: "0a1b2c3d-0000-4000-8000-00000000000a",
  accessToken: "synthetic-access-token",
};

/** One request as the fake server saw it. */
export interface Call {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Record<string, string>;
  /** The body as text; empty when there was none. */
  readonly body: string;
}

/** A recording stand-in for `fetch`. */
export function server(respond: (call: Call) => Response | Promise<Response>): {
  calls: Call[];
  fetch: typeof fetch;
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (input, init = {}) => {
      // Checked by shape: the bytes can come from another realm in jsdom.
      const body = ArrayBuffer.isView(init.body)
        ? new TextDecoder().decode(init.body)
        : "";
      const call = {
        url: String(input),
        init,
        headers: init.headers as Record<string, string>,
        body,
      };
      calls.push(call);
      return Promise.resolve(call).then(respond);
    },
  };
}

/** A JSON response. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A device identity for tests, with a way to check what it signed. */
export interface TestIdentity extends DeviceIdentity {
  verify(message: Uint8Array<ArrayBuffer>, signature: string): Promise<boolean>;
}

/** Make an identity with a fresh key pair. */
export async function testIdentity(
  deviceId = "d0000000-0000-4000-8000-00000000000a",
  registered = true,
): Promise<TestIdentity> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const algorithm = { name: "ECDSA", hash: "SHA-256" };
  return {
    deviceId,
    publicKey: toBase64(
      new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    ),
    registered,
    sign: async (message) =>
      toBase64(
        new Uint8Array(
          await crypto.subtle.sign(algorithm, pair.privateKey, message),
        ),
      ),
    verify: (message, signature) =>
      crypto.subtle.verify(
        algorithm,
        pair.publicKey,
        fromBase64(signature),
        message,
      ),
  };
}

/** An identity store that holds identities in memory. */
export class MemoryIdentityStore implements DeviceIdentityStore {
  readonly #identities = new Map<string, DeviceIdentity>();

  get(userId: string): Promise<DeviceIdentity | undefined> {
    return Promise.resolve(this.#identities.get(userId));
  }

  async getOrCreate(userId: string): Promise<DeviceIdentity> {
    const existing = this.#identities.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = await testIdentity(crypto.randomUUID(), false);
    this.#identities.set(userId, fresh);
    return fresh;
  }

  markRegistered(userId: string): Promise<void> {
    const existing = this.#identities.get(userId);
    if (existing !== undefined) {
      this.#identities.set(userId, { ...existing, registered: true });
    }
    return Promise.resolve();
  }

  forget(userId: string): Promise<void> {
    this.#identities.delete(userId);
    return Promise.resolve();
  }
}

/** The synthetic root key used by the committed fixtures: bytes 0 to 31. */
export function fixtureRootKey(): Promise<RootKey> {
  return importRootKey(Uint8Array.from({ length: 32 }, (_, index) => index));
}

/** A second, different root key. */
export function otherRootKey(): Promise<RootKey> {
  return importRootKey(new Uint8Array(32).fill(7));
}
