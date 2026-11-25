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
import type { DeviceIdentityStore } from "../devices/identity";
import { ApiClient, ApiError } from "./client";
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

/** A recovery envelope to store, and the version it replaces. */
export interface RecoveryEnvelopeWrite {
  /** The stored version this replaces; 0 creates the first envelope. */
  readonly expectedVersion: number;
  /** The wrapped root key. */
  readonly envelope: Uint8Array<ArrayBuffer>;
  /** The envelope format the bytes were written in. */
  readonly formatVersion: number;
  /**
   * What a new device must prove it knows before it may register (see
   * `deviceEnrollmentVerifier`). Sent once, with the first envelope, and
   * ignored when replacing one.
   */
  readonly enrollmentVerifier: Uint8Array<ArrayBuffer>;
}

/** Reads and replaces the signed-in account's recovery envelope. */
export interface RecoveryEnvelopeStore {
  /** @returns The envelope, or `undefined` if the account has none yet. */
  read(session: AuthSession): Promise<StoredRecoveryEnvelope | undefined>;
  /**
   * Create or replace the envelope, only if the stored version is still the
   * expected one.
   *
   * @returns `false` if the stored version had moved on; nothing was changed.
   */
  write(session: AuthSession, change: RecoveryEnvelopeWrite): Promise<boolean>;
}

const PATH = "/v1/recovery-envelope";

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

/** Report a failure to reach the API in the vault's own terms. */
function asVaultError(error: unknown): unknown {
  if (
    error instanceof ApiError &&
    (error.code === "offline" || error.code === "signed_out")
  ) {
    return new VaultError(error.code);
  }
  return error;
}

/** The recovery envelope held by the Warmly API. */
export class ApiRecoveryEnvelopeStore implements RecoveryEnvelopeStore {
  readonly #api: ApiClient;
  readonly #identities: DeviceIdentityStore;

  /**
   * @param api - The API client.
   * @param identities - This device's identity, which signs a replacement.
   */
  constructor(api: ApiClient, identities: DeviceIdentityStore) {
    this.#api = api;
    this.#identities = identities;
  }

  async read(
    session: AuthSession,
  ): Promise<StoredRecoveryEnvelope | undefined> {
    // Not signed: a new device reads the envelope before it can register.
    const response = await this.#api
      .send(session, { method: "GET", path: PATH, signedBy: undefined })
      .catch((error: unknown) => {
        throw asVaultError(error);
      });
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
    change: RecoveryEnvelopeWrite,
  ): Promise<boolean> {
    const creating = change.expectedVersion === 0;
    const body: WireRequest = {
      expected_version: change.expectedVersion,
      format_version: change.formatVersion,
      wrapped_key: toBase64(change.envelope),
      ...(creating
        ? { device_enrollment_verifier: toBase64(change.enrollmentVerifier) }
        : {}),
    };
    // Creating the first envelope cannot be signed: no device can register
    // before it exists. Replacing one must be signed by a registered device.
    const signedBy = creating
      ? undefined
      : await this.#identities.get(session.userId);
    const response = await this.#api
      .send(session, { method: "PUT", path: PATH, body, signedBy })
      .catch((error: unknown) => {
        throw asVaultError(error);
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
