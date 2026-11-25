/**
 * The server's part in pairing two of an account's devices, as the app
 * reaches it (PRD DEV-001 path A; ADR-0005).
 *
 * The relay passes messages between the devices. Nothing in this module
 * trusts it: every value it returns is checked by the pairing code that both
 * people compare, and the root key crosses it only as ciphertext.
 */
import { ApiClient, ApiError } from "../api/client";
import type { components } from "../api/schema";
import type { AuthSession } from "../auth/auth-client";
import type { DeviceIdentity } from "./identity";

type WireEnrollment = components["schemas"]["Enrollment"];
type WireStatus = WireEnrollment["status"];

/** One pairing as the relay holds it. Byte values are base64. */
export interface PairingRequest {
  readonly id: string;
  /** The new device's ID. */
  readonly deviceId: string;
  /** The new device's one-time key-transfer public key. */
  readonly publicKey: string;
  /** The new device's commitment to its random value. */
  readonly commitment: string;
  /** A random value chosen by the relay. */
  readonly challenge: string;
  readonly status: WireStatus;
  /** When the request stops being usable, as an ISO 8601 timestamp. */
  readonly expiresAt: string;
  readonly approverNonce: string | undefined;
  readonly joinerNonce: string | undefined;
  /** The root key, encrypted to the new device. */
  readonly wrappedKey: string | undefined;
}

/** What a new device sends to ask for approval. */
export interface PairingStart {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly commitment: string;
}

/**
 * Relays a pairing. A step that cannot happen, because the request has
 * expired, was refused, or is not at that step, returns `undefined`.
 */
export interface PairingRelay {
  /** New device: open a request. */
  start(session: AuthSession, start: PairingStart): Promise<PairingRequest>;
  /** Either device: read a request; `undefined` if it is not the account's. */
  read(session: AuthSession, id: string): Promise<PairingRequest | undefined>;
  /** New device: give up its own request, so it does not stay open. */
  cancel(session: AuthSession, id: string): Promise<void>;
  /** Approving device: the request nobody has taken up, if there is one. */
  openRequest(
    session: AuthSession,
    identity: DeviceIdentity,
  ): Promise<PairingRequest | undefined>;
  /** Approving device: take up a request and contribute a random value. */
  claim(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
    approverNonce: string,
  ): Promise<PairingRequest | undefined>;
  /** New device: reveal the random value it committed to. */
  reveal(
    session: AuthSession,
    id: string,
    joinerNonce: string,
  ): Promise<PairingRequest | undefined>;
  /** Approving device: deliver the root key, encrypted to the new device. */
  approve(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
    wrappedKey: string,
  ): Promise<PairingRequest | undefined>;
  /** Approving device: refuse the request. */
  reject(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
  ): Promise<void>;
}

const PATH = "/v1/enrollments";
const STATUSES: readonly string[] = [
  "pending",
  "claimed",
  "revealed",
  "approved",
  "rejected",
  "expired",
] satisfies readonly WireStatus[];

function text(value: object, key: string): string | undefined {
  const found: unknown = (value as Record<string, unknown>)[key];
  return typeof found === "string" ? found : undefined;
}

function fromWire(value: unknown): PairingRequest {
  if (typeof value !== "object" || value === null) {
    throw new ApiError("unexpected");
  }
  const request = {
    id: text(value, "id"),
    deviceId: text(value, "device_id"),
    publicKey: text(value, "public_key"),
    commitment: text(value, "commitment"),
    challenge: text(value, "challenge"),
    status: text(value, "status"),
    expiresAt: text(value, "expires_at"),
  };
  const { id, deviceId, publicKey, commitment, challenge, status, expiresAt } =
    request;
  if (
    id === undefined ||
    deviceId === undefined ||
    publicKey === undefined ||
    commitment === undefined ||
    challenge === undefined ||
    expiresAt === undefined ||
    status === undefined ||
    !STATUSES.includes(status)
  ) {
    throw new ApiError("unexpected");
  }
  return {
    id,
    deviceId,
    publicKey,
    commitment,
    challenge,
    status: status as WireStatus,
    expiresAt,
    approverNonce: text(value, "approver_nonce"),
    joinerNonce: text(value, "joiner_nonce"),
    wrappedKey: text(value, "wrapped_key"),
  };
}

/** The pairing relay provided by the Warmly API. */
export class ApiPairingRelay implements PairingRelay {
  readonly #api: ApiClient;

  /** @param api - The API client. */
  constructor(api: ApiClient) {
    this.#api = api;
  }

  /** Read a response: the request, or `undefined` for 404 and 409. */
  async #request(response: Response): Promise<PairingRequest | undefined> {
    if (response.status === 404 || response.status === 409) {
      return undefined;
    }
    if (!response.ok) {
      throw new ApiError("unexpected");
    }
    return fromWire(await response.json());
  }

  async start(
    session: AuthSession,
    start: PairingStart,
  ): Promise<PairingRequest> {
    // Not signed: the new device has no registered key yet.
    const response = await this.#api.send(session, {
      method: "POST",
      path: PATH,
      body: {
        device_id: start.deviceId,
        public_key: start.publicKey,
        commitment: start.commitment,
      } satisfies components["schemas"]["StartEnrollmentRequest"],
      signedBy: undefined,
    });
    if (!response.ok) {
      throw new ApiError("unexpected");
    }
    return fromWire(await response.json());
  }

  async read(
    session: AuthSession,
    id: string,
  ): Promise<PairingRequest | undefined> {
    return this.#request(
      await this.#api.send(session, {
        method: "GET",
        path: `${PATH}/${encodeURIComponent(id)}`,
        signedBy: undefined,
      }),
    );
  }

  async cancel(session: AuthSession, id: string): Promise<void> {
    await this.#request(
      await this.#api.send(session, {
        method: "POST",
        path: `${PATH}/${encodeURIComponent(id)}/cancel`,
        signedBy: undefined,
      }),
    );
  }

  async openRequest(
    session: AuthSession,
    identity: DeviceIdentity,
  ): Promise<PairingRequest | undefined> {
    return this.#request(
      await this.#api.send(session, {
        method: "GET",
        path: `${PATH}/open`,
        signedBy: identity,
      }),
    );
  }

  async claim(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
    approverNonce: string,
  ): Promise<PairingRequest | undefined> {
    return this.#request(
      await this.#api.send(session, {
        method: "POST",
        path: `${PATH}/${encodeURIComponent(id)}/claim`,
        body: {
          approver_nonce: approverNonce,
        } satisfies components["schemas"]["ClaimEnrollmentRequest"],
        signedBy: identity,
      }),
    );
  }

  async reveal(
    session: AuthSession,
    id: string,
    joinerNonce: string,
  ): Promise<PairingRequest | undefined> {
    return this.#request(
      await this.#api.send(session, {
        method: "POST",
        path: `${PATH}/${encodeURIComponent(id)}/reveal`,
        body: {
          joiner_nonce: joinerNonce,
        } satisfies components["schemas"]["RevealEnrollmentRequest"],
        signedBy: undefined,
      }),
    );
  }

  async approve(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
    wrappedKey: string,
  ): Promise<PairingRequest | undefined> {
    return this.#request(
      await this.#api.send(session, {
        method: "POST",
        path: `${PATH}/${encodeURIComponent(id)}/approve`,
        body: {
          wrapped_key: wrappedKey,
        } satisfies components["schemas"]["ApproveEnrollmentRequest"],
        signedBy: identity,
      }),
    );
  }

  async reject(
    session: AuthSession,
    identity: DeviceIdentity,
    id: string,
  ): Promise<void> {
    await this.#request(
      await this.#api.send(session, {
        method: "POST",
        path: `${PATH}/${encodeURIComponent(id)}/reject`,
        signedBy: identity,
      }),
    );
  }
}
