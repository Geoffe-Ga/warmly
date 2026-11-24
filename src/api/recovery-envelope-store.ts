/**
 * Where the recovery envelope lives: the Warmly API (PRD SEC-003).
 *
 * The envelope is the account root key wrapped by the recovery key. Only the
 * wrapped bytes cross this boundary. The recovery key and the root key never
 * do.
 */
import type { AuthSession } from "../auth/auth-client";
import { fromBase64, toBase64 } from "../crypto/encoding";
import { VaultError } from "../crypto/key-vault";
import type { components } from "./schema";

type WireEnvelope = components["schemas"]["RecoveryEnvelope"];
type WireRequest = components["schemas"]["PutRecoveryEnvelopeRequest"];

/** A recovery envelope as stored, with the version used for replacing it. */
export interface StoredRecoveryEnvelope {
  /** Increases by one each time the recovery key is replaced. */
  readonly version: number;
  /** The wrapped root key. */
  readonly envelope: Uint8Array<ArrayBuffer>;
}

/** Reads and replaces the signed-in account's recovery envelope. */
export interface RecoveryEnvelopeStore {
  /** @returns The envelope, or `undefined` if the account has none yet. */
  read(session: AuthSession): Promise<StoredRecoveryEnvelope | undefined>;
  /**
   * Create (`expectedVersion` 0) or replace the envelope, only if the stored
   * version is still the expected one.
   *
   * @returns `false` if the stored version had moved on; nothing was changed.
   */
  write(
    session: AuthSession,
    expectedVersion: number,
    envelope: Uint8Array<ArrayBuffer>,
  ): Promise<boolean>;
}

const PATH = "/v1/recovery-envelope";
const FORMAT_VERSION_FIELD = 1;

function isWireEnvelope(value: unknown): value is WireEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "number" &&
    "wrapped_key" in value &&
    typeof value.wrapped_key === "string"
  );
}

/** The recovery envelope held by the Warmly API. */
export class ApiRecoveryEnvelopeStore implements RecoveryEnvelopeStore {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  /**
   * @param baseUrl - Origin of the Warmly API; empty for the app's own origin.
   * @param fetchFn - The network function. Injected so tests never touch the
   *   network.
   */
  constructor(baseUrl: string, fetchFn: typeof fetch) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#fetch = fetchFn;
  }

  async #request(
    session: AuthSession,
    init: RequestInit = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(this.#baseUrl + PATH, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        // The token is the only credential; cookies are never sent.
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new VaultError("offline");
    }
    if (response.status === 401) {
      throw new VaultError("signed_out");
    }
    return response;
  }

  async read(
    session: AuthSession,
  ): Promise<StoredRecoveryEnvelope | undefined> {
    const response = await this.#request(session);
    if (response.status === 404) {
      return undefined;
    }
    const body: unknown = response.ok ? await response.json() : undefined;
    if (!isWireEnvelope(body)) {
      throw new Error("The recovery envelope could not be read");
    }
    return { version: body.version, envelope: fromBase64(body.wrapped_key) };
  }

  async write(
    session: AuthSession,
    expectedVersion: number,
    envelope: Uint8Array<ArrayBuffer>,
  ): Promise<boolean> {
    const request: WireRequest = {
      expected_version: expectedVersion,
      format_version: envelope[0] ?? FORMAT_VERSION_FIELD,
      wrapped_key: toBase64(envelope),
    };
    const response = await this.#request(session, {
      method: "PUT",
      body: JSON.stringify(request),
    });
    if (response.status === 409) {
      return false;
    }
    if (!response.ok) {
      throw new Error("The recovery envelope could not be saved");
    }
    return true;
  }
}
