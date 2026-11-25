/**
 * How the sync engine reaches the server (ADR-0006).
 *
 * The engine depends on the {@link SyncTransport} interface only. The real
 * transport sends signed requests through the API client; tests use the
 * in-memory server.
 */
import { ApiError, type ApiClient } from "../api/client";
import type { components } from "../api/schema";
import type { AuthClient } from "../auth/auth-client";
import { fromBase64, toBase64 } from "../crypto/encoding";
import type { DeviceIdentityStore } from "../devices/identity";
import type {
  ChangePage,
  OperationResult,
  OperationStatus,
  RemoteChange,
  SyncOperation,
} from "./protocol";

/**
 * Sync cannot be used right now for a reason that is not the network: the
 * server does not offer it yet, or this device is not signed in and
 * registered. Changes stay queued. Nothing is wrong with them.
 */
export class SyncUnavailableError extends Error {
  constructor() {
    super("Sync is not available");
    this.name = "SyncUnavailableError";
  }
}

/** Sends operations and asks for changes. */
export interface SyncTransport {
  /**
   * Send a batch of operations.
   *
   * @param operations - Between 1 and 100 operations.
   * @returns One result per operation, in the same order.
   * @throws ApiError `offline` if the server could not be reached.
   * @throws SyncUnavailableError if sync cannot be used right now.
   */
  push(operations: readonly SyncOperation[]): Promise<OperationResult[]>;
  /**
   * Ask for the changes after a cursor.
   *
   * @param cursor - The last cursor received; `"0"` to start.
   * @returns One page of changes.
   * @throws ApiError `offline` if the server could not be reached.
   * @throws SyncUnavailableError if sync cannot be used right now.
   */
  pull(cursor: string): Promise<ChangePage>;
}

/** A transport for a build with no server to sync with. */
export const UNAVAILABLE_TRANSPORT: SyncTransport = {
  push: () => Promise.reject(new SyncUnavailableError()),
  pull: () => Promise.reject(new SyncUnavailableError()),
};

type WireOperation = components["schemas"]["SyncOperation"];
type WireResult = components["schemas"]["OperationResult"];
type WireChange = components["schemas"]["Change"];

/** The header a route sends while it is still a stub. */
const STUB_HEADER = "Warmly-Stub";

const STATUSES: readonly OperationStatus[] = [
  "applied",
  "duplicate",
  "conflict",
  "deleted",
  "rejected",
];

function toWire(operation: SyncOperation): WireOperation {
  return {
    op_id: operation.opId,
    record_id: operation.recordId,
    type: operation.type,
    base_revision: operation.baseRevision,
    schema_version: operation.schemaVersion,
    tombstone: operation.tombstone,
    payload: operation.payload === null ? null : toBase64(operation.payload),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === "number";
}

function isWireResult(value: unknown): value is WireResult {
  return (
    isObject(value) &&
    typeof value["op_id"] === "string" &&
    STATUSES.some((status) => status === value["status"]) &&
    optionalNumber(value["revision"]) &&
    optionalNumber(value["current_revision"])
  );
}

function resultFromWire(wire: WireResult): OperationResult {
  return {
    opId: wire.op_id,
    status: wire.status,
    ...(typeof wire.revision === "number" ? { revision: wire.revision } : {}),
    ...(typeof wire.current_revision === "number"
      ? { currentRevision: wire.current_revision }
      : {}),
  };
}

function isWireChange(value: unknown): value is WireChange {
  return (
    isObject(value) &&
    typeof value["record_id"] === "string" &&
    typeof value["type"] === "number" &&
    typeof value["revision"] === "number" &&
    typeof value["sequence"] === "number" &&
    typeof value["schema_version"] === "number" &&
    typeof value["tombstone"] === "boolean" &&
    (value["payload"] === undefined ||
      value["payload"] === null ||
      typeof value["payload"] === "string") &&
    // A tombstone has no payload and a live record has one.
    value["tombstone"] === (typeof value["payload"] !== "string")
  );
}

function changeFromWire(wire: WireChange): RemoteChange {
  return {
    recordId: wire.record_id,
    type: wire.type,
    revision: wire.revision,
    sequence: wire.sequence,
    schemaVersion: wire.schema_version,
    tombstone: wire.tombstone,
    payload: typeof wire.payload === "string" ? fromBase64(wire.payload) : null,
  };
}

/** The sync transport over the Warmly API: signed, ciphertext only. */
export class ApiSyncTransport implements SyncTransport {
  readonly #api: ApiClient;
  readonly #auth: AuthClient;
  readonly #identities: DeviceIdentityStore;

  /**
   * @param api - Sends signed requests.
   * @param auth - Says who is signed in.
   * @param identities - Holds this device's signing key.
   */
  constructor(
    api: ApiClient,
    auth: AuthClient,
    identities: DeviceIdentityStore,
  ) {
    this.#api = api;
    this.#auth = auth;
    this.#identities = identities;
  }

  /** Send one request, signed by this device, and read its JSON body. */
  async #request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const session = await this.#auth.currentSession();
    const identity =
      session === undefined
        ? undefined
        : await this.#identities.get(session.userId);
    if (session === undefined || identity === undefined) {
      throw new SyncUnavailableError();
    }
    const response = await this.#api.send(session, {
      method,
      path,
      signedBy: identity,
      ...(body === undefined ? {} : { body }),
    });
    // A stub answers with fixed data and stores nothing. Treating it as a
    // real answer would report every change as refused.
    if (response.headers.get(STUB_HEADER) === "true") {
      throw new SyncUnavailableError();
    }
    if (!response.ok) {
      throw new ApiError("unexpected");
    }
    return response.json();
  }

  async push(operations: readonly SyncOperation[]): Promise<OperationResult[]> {
    const body = await this.#request("POST", "/v1/sync/operations", {
      operations: operations.map(toWire),
    });
    const results = isObject(body) ? body["results"] : undefined;
    if (
      !Array.isArray(results) ||
      results.length !== operations.length ||
      !results.every(isWireResult) ||
      // Results come back in request order, one for each operation.
      !results.every(
        (result, index) => result.op_id === operations[index]?.opId,
      )
    ) {
      throw new ApiError("unexpected");
    }
    return results.map(resultFromWire);
  }

  async pull(cursor: string): Promise<ChangePage> {
    const body = await this.#request(
      "GET",
      `/v1/sync/changes?cursor=${encodeURIComponent(cursor)}`,
    );
    if (
      !isObject(body) ||
      !Array.isArray(body["changes"]) ||
      !body["changes"].every(isWireChange) ||
      typeof body["next_cursor"] !== "string" ||
      typeof body["has_more"] !== "boolean"
    ) {
      throw new ApiError("unexpected");
    }
    return {
      changes: body["changes"].map(changeFromWire),
      nextCursor: body["next_cursor"],
      hasMore: body["has_more"],
    };
  }
}
