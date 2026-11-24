/**
 * The real {@link AuthClient}, backed by Supabase Auth (PRD §8).
 *
 * Only the auth-only client package is used. The browser never calls the
 * Supabase Data API: all data goes through the Warmly API as ciphertext.
 *
 * What this client deliberately does not do:
 * - It never reads a session out of the URL. Email links come back with a
 *   one-time code, which is only ever used to set a new password.
 * - It never reveals whether an address has an account.
 * - It never shows or logs the provider's own error text.
 */
import {
  AuthClient as SupabaseAuth,
  isAuthRetryableFetchError,
} from "@supabase/auth-js";

import { AuthError, type AuthClient, type AuthErrorCode } from "./auth-client";

/** Where the Supabase project is and the key that identifies this app. */
export interface SupabaseAuthConfig {
  /** The project URL, for example `https://abcd.supabase.co`. */
  readonly url: string;
  /** The publishable key. It is public by design and grants nothing itself. */
  readonly publishableKey: string;
}

/** What an auth call returns: the provider's error object, if it failed. */
interface Outcome {
  readonly error: unknown;
}

interface SessionOutcome extends Outcome {
  readonly data: { readonly session: object | null };
}

/**
 * The few provider calls this client uses. Narrowing the dependency to this
 * interface keeps the surface small and lets tests supply a stand-in, since a
 * unit test may not touch the network.
 */
export interface AuthApi {
  getSession(): Promise<SessionOutcome>;
  signUp(credentials: {
    email: string;
    password: string;
    options: { emailRedirectTo: string };
  }): Promise<Outcome>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<Outcome>;
  signOut(options: { scope: "local" }): Promise<Outcome>;
  resetPasswordForEmail(
    email: string,
    options: { redirectTo: string },
  ): Promise<Outcome>;
  exchangeCodeForSession(code: string): Promise<Outcome>;
  updateUser(attributes: { password: string }): Promise<Outcome>;
}

/** The parts of the page this client reads and changes. */
export interface PageLocation {
  /** The app's origin, used to build the addresses email links return to. */
  readonly origin: string;
  /** The one-time code in the current address, if there is one. */
  readCode(): string | null;
  /** Remove the code from the address bar and history entry. */
  clearCode(): void;
}

/** Path the verification email returns to. */
export const VERIFY_RETURN_PATH = "/welcome/verify";
/** Path the password-reset email returns to. */
export const NEW_PASSWORD_PATH = "/sign-in/new-password";

const CODE_PARAMETER = "code";
/** Where the auth library keeps the session in `localStorage`. */
export const SESSION_STORAGE_KEY = "warmly.auth";

// Provider error codes that have their own wording. Anything else is shown as
// an unexpected failure, with no detail.
const KNOWN_CODES: ReadonlyMap<string, AuthErrorCode> = new Map([
  ["invalid_credentials", "invalid_credentials"],
  ["email_not_confirmed", "email_not_verified"],
  ["weak_password", "weak_password"],
  ["over_request_rate_limit", "rate_limited"],
  ["over_email_send_rate_limit", "rate_limited"],
]);

function providerCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

/**
 * Turn a provider error into one of this app's errors. The provider's message
 * is dropped: it can name the address or other detail.
 */
function translate(error: unknown): Error {
  if (isAuthRetryableFetchError(error)) {
    return new AuthError("offline");
  }
  const code = KNOWN_CODES.get(providerCode(error) ?? "");
  return code === undefined
    ? new Error("The auth provider reported an unexpected error")
    : new AuthError(code);
}

function check(outcome: Outcome): void {
  if (outcome.error !== null && outcome.error !== undefined) {
    throw translate(outcome.error);
  }
}

/** The browser's address bar as a {@link PageLocation}. */
export function browserLocation(): PageLocation {
  return {
    origin: window.location.origin,
    readCode: () =>
      new URLSearchParams(window.location.search).get(CODE_PARAMETER),
    clearCode: () => {
      const url = new URL(window.location.href);
      url.searchParams.delete(CODE_PARAMETER);
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search,
      );
    },
  };
}

/**
 * Remove everything the auth library stored for this app: the session and
 * its companion entries, which share the session key as a prefix.
 *
 * @param storage - The storage the library was given.
 */
export function forgetStoredSession(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  );
  for (const key of keys) {
    if (
      key === SESSION_STORAGE_KEY ||
      key?.startsWith(`${SESSION_STORAGE_KEY}-`)
    ) {
      storage.removeItem(key);
    }
  }
}

/** See the module comment. */
export class SupabaseAuthClient implements AuthClient {
  readonly #api: AuthApi;
  readonly #page: PageLocation;
  readonly #forgetStoredSession: () => void;
  /**
   * The credentials typed at registration, kept in memory only until the
   * address is verified, so the user does not have to type them twice.
   */
  #pending: { email: string; password: string } | undefined;
  /** True once this page has traded a reset link for a short-lived session. */
  #resetLinkAccepted = false;

  /**
   * @param api - The provider calls to use.
   * @param page - The page's address.
   * @param forgetSession - Removes any session the library persisted. Called
   *   on every sign-out, whatever the library reports.
   */
  constructor(api: AuthApi, page: PageLocation, forgetSession: () => void) {
    this.#api = api;
    this.#page = page;
    this.#forgetStoredSession = forgetSession;
  }

  async isSignedIn(): Promise<boolean> {
    const outcome = await this.#api.getSession();
    check(outcome);
    return outcome.data.session !== null;
  }

  async register(email: string, password: string): Promise<void> {
    const outcome = await this.#api.signUp({
      email,
      password,
      options: { emailRedirectTo: this.#page.origin + VERIFY_RETURN_PATH },
    });
    // Saying "already registered" would reveal who has an account.
    if (providerCode(outcome.error) !== "user_already_exists") {
      check(outcome);
    }
    this.#pending = { email, password };
  }

  async completeVerification(): Promise<boolean> {
    if (this.#pending === undefined) {
      return this.isSignedIn();
    }
    const outcome = await this.#api.signInWithPassword(this.#pending);
    const code = providerCode(outcome.error);
    // "Wrong password" here means the address already had an account. The
    // answer is the same as for an unopened link, so nothing is revealed.
    if (code === "email_not_confirmed" || code === "invalid_credentials") {
      return false;
    }
    check(outcome);
    this.#pending = undefined;
    return true;
  }

  async signIn(email: string, password: string): Promise<void> {
    check(await this.#api.signInWithPassword({ email, password }));
    this.#pending = undefined;
  }

  async signOut(): Promise<void> {
    this.#pending = undefined;
    this.#resetLinkAccepted = false;
    try {
      // "local" asks the library to remove this device's session before the
      // server is contacted. Failing to reach the server afterwards is not
      // something the user can act on, so its error is not reported.
      await this.#api.signOut({ scope: "local" });
    } finally {
      // Not left to the library: whatever it did or threw, nothing may stay
      // signed in on a device someone else might use next.
      this.#forgetStoredSession();
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    check(
      await this.#api.resetPasswordForEmail(email, {
        redirectTo: this.#page.origin + NEW_PASSWORD_PATH,
      }),
    );
  }

  async completePasswordReset(newPassword: string): Promise<void> {
    const code = this.#page.readCode();
    if (code !== null) {
      // A code works once. Take it out of the address bar whatever happens,
      // so it is not left in history or retried.
      this.#page.clearCode();
      const exchange = await this.#api.exchangeCodeForSession(code);
      if (isAuthRetryableFetchError(exchange.error)) {
        throw new AuthError("offline");
      }
      this.#resetLinkAccepted =
        exchange.error === null || exchange.error === undefined;
    }
    // Only a link accepted on this page may set a password. An ordinary
    // signed-in session must not be enough.
    if (!this.#resetLinkAccepted) {
      throw new AuthError("reset_link_invalid");
    }
    const update = await this.#api.updateUser({ password: newPassword });
    if (providerCode(update.error) === "weak_password") {
      // The link stays accepted so the user can choose a stronger password.
      throw new AuthError("weak_password");
    }
    try {
      check(update);
    } finally {
      // Success or not, the link's session ends here: the user signs in with
      // the new password, and nothing is left signed in on a shared device.
      await this.signOut();
    }
  }
}

/**
 * Build the real client for a Supabase project.
 *
 * @param config - The project URL and publishable key.
 * @param options - `fetch` replaces the network function; tests use it to
 *   stand in for the server.
 * @returns A client that talks to the project's auth endpoint only.
 */
export function createSupabaseAuthClient(
  config: SupabaseAuthConfig,
  options: { readonly fetch?: typeof fetch } = {},
): SupabaseAuthClient {
  const api = new SupabaseAuth({
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    url: new URL("auth/v1", ensureTrailingSlash(config.url)).href,
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${config.publishableKey}`,
    },
    storageKey: SESSION_STORAGE_KEY,
    storage: localStorage,
    // The code in an email link is exchanged explicitly, and only to set a
    // new password. Nothing in a URL can sign anyone in by itself.
    flowType: "pkce",
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  });
  return new SupabaseAuthClient(api, browserLocation(), () => {
    forgetStoredSession(localStorage);
  });
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Read the Supabase settings from the build's environment.
 *
 * @param env - The build-time variables.
 * @returns The configuration, or `undefined` if either value is missing.
 */
export function readSupabaseAuthConfig(
  env: Readonly<Record<string, unknown>>,
): SupabaseAuthConfig | undefined {
  const url = env["VITE_SUPABASE_URL"];
  const publishableKey = env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  return typeof url === "string" &&
    url !== "" &&
    typeof publishableKey === "string" &&
    publishableKey !== ""
    ? { url, publishableKey }
    : undefined;
}
