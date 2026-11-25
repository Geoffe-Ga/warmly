/**
 * The one place the app talks to the Warmly API (ADR-0005).
 *
 * Every request carries the session token. Every request except the few a
 * device must make before it is registered is also signed by this device's
 * key. Nothing here ever sends plaintext: callers pass ciphertext and opaque
 * identifiers only.
 */
import type { AuthSession } from "../auth/auth-client";
import { utf8 } from "../crypto/encoding";
import type { DeviceIdentity } from "../devices/identity";
import { newNonce, signingMessage } from "../devices/signing";

/** Why an API call failed, in terms the UI can explain. */
export type ApiErrorCode =
  | "offline"
  | "signed_out"
  | "device_not_authorized"
  | "clock_wrong"
  | "unexpected";

/** A failed API call. Carries a code only, never the server's text. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode) {
    super(`The Warmly API call failed: ${code}`);
    this.name = "ApiError";
    this.code = code;
  }
}

/** A request for {@link ApiClient.send}. */
export interface ApiRequest {
  readonly method: "GET" | "POST" | "PUT" | "PATCH";
  /** Path and query, starting with `/v1/`. */
  readonly path: string;
  /** A JSON-serialisable body, if the request has one. */
  readonly body?: unknown;
  /**
   * The identity that signs the request, or `undefined` for the few requests
   * a device makes before it is registered.
   */
  readonly signedBy: DeviceIdentity | undefined;
}

const DEVICE_ERRORS: Readonly<Record<string, ApiErrorCode>> = {
  "device.stale_request": "clock_wrong",
};

async function refusal(response: Response): Promise<ApiError> {
  let code = "";
  try {
    const problem: unknown = await response.json();
    if (
      typeof problem === "object" &&
      problem !== null &&
      "code" in problem &&
      typeof problem.code === "string"
    ) {
      code = problem.code;
    }
  } catch {
    // A 401 without a readable body is still a 401.
  }
  if (code.startsWith("device.")) {
    return new ApiError(DEVICE_ERRORS[code] ?? "device_not_authorized");
  }
  return new ApiError("signed_out");
}

/** Sends requests to the Warmly API. */
export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  /**
   * @param baseUrl - Origin of the Warmly API; empty for the app's own origin.
   * @param fetchFn - The network function. Injected so tests never touch the
   *   network.
   * @param now - Milliseconds since the epoch; tests pass their own.
   */
  constructor(
    baseUrl: string,
    fetchFn: typeof fetch,
    now: () => number = () => Date.now(),
  ) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#fetch = fetchFn;
    this.#now = now;
  }

  async #signature(
    request: ApiRequest,
    body: Uint8Array<ArrayBuffer>,
  ): Promise<Record<string, string>> {
    const identity = request.signedBy;
    if (identity === undefined) {
      return {};
    }
    const timestamp = Math.floor(this.#now() / 1000);
    const nonce = newNonce();
    const message = await signingMessage({
      method: request.method,
      target: request.path,
      body,
      deviceId: identity.deviceId,
      timestamp,
      nonce,
    });
    return {
      "Warmly-Device": identity.deviceId,
      "Warmly-Timestamp": String(timestamp),
      "Warmly-Nonce": nonce,
      "Warmly-Signature": await identity.sign(message),
    };
  }

  /**
   * Send a request.
   *
   * @param session - The signed-in session.
   * @param request - What to send.
   * @returns The response, for any status other than 401. The caller decides
   *   what each status means.
   * @throws ApiError `offline` if the server could not be reached, and
   *   `signed_out`, `device_not_authorized` or `clock_wrong` for a 401.
   */
  async send(session: AuthSession, request: ApiRequest): Promise<Response> {
    const hasBody = request.body !== undefined;
    // Serialised once: the bytes that are signed are the bytes that are sent.
    const body = utf8(hasBody ? JSON.stringify(request.body) : "");
    const signature = await this.#signature(request, body);
    let response: Response;
    try {
      response = await this.#fetch(this.#baseUrl + request.path, {
        method: request.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...signature,
        },
        ...(hasBody ? { body } : {}),
        // The token and the signature are the only credentials.
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new ApiError("offline");
    }
    if (response.status === 401) {
      throw await refusal(response);
    }
    return response;
  }
}
