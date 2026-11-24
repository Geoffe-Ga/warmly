/**
 * In-memory {@link AuthClient} for development, unit tests and the `e2e`
 * build. It must never be part of a production build; `services.ts` selects it
 * behind a compile-time condition and a browser test checks the real bundle.
 *
 * It keeps its small state in `sessionStorage` so a page reload behaves like a
 * real signed-in session. Everything in it is synthetic: there is no server,
 * no email is sent, and "verification" succeeds as soon as it is asked for.
 */
import { AuthError, type AuthClient } from "../auth/auth-client";

const STORAGE_KEY = "warmly.fake.auth";

interface FakeAuthState {
  /**
   * Registered accounts as [email, password] pairs. A list, not an object
   * keyed by email, so an address such as `__proto__` is just another string.
   * Synthetic values only.
   */
  accounts: [email: string, password: string][];
  /** The address awaiting verification, if any. */
  pending: string | null;
  /** The signed-in address, if any. */
  signedIn: string | null;
  /** The address a reset link was last "sent" to, if it is still unused. */
  resetFor: string | null;
}

const EMPTY: FakeAuthState = {
  accounts: [],
  pending: null,
  signedIn: null,
  resetFor: null,
};

function passwordFor(state: FakeAuthState, email: string): string | undefined {
  return state.accounts.find(([registered]) => registered === email)?.[1];
}

/** See the module comment. */
export class FakeAuthClient implements AuthClient {
  readonly #storage: Storage;

  constructor(storage: Storage = sessionStorage) {
    this.#storage = storage;
  }

  #read(): FakeAuthState {
    const raw = this.#storage.getItem(STORAGE_KEY);
    return raw === null
      ? structuredClone(EMPTY)
      : (JSON.parse(raw) as FakeAuthState);
  }

  #write(state: FakeAuthState): void {
    this.#storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  isSignedIn(): Promise<boolean> {
    return Promise.resolve(this.#read().signedIn !== null);
  }

  register(email: string, password: string): Promise<void> {
    const state = this.#read();
    // An existing account is left completely untouched, and the caller cannot
    // tell. In particular it does not become "pending": otherwise anyone could
    // register someone else's address and then verify their way into it.
    if (passwordFor(state, email) === undefined) {
      state.accounts.push([email, password]);
      state.pending = email;
      this.#write(state);
    }
    return Promise.resolve();
  }

  completeVerification(): Promise<boolean> {
    const state = this.#read();
    if (state.pending === null) {
      return Promise.resolve(false);
    }
    state.signedIn = state.pending;
    state.pending = null;
    this.#write(state);
    return Promise.resolve(true);
  }

  signIn(email: string, password: string): Promise<void> {
    const state = this.#read();
    if (passwordFor(state, email) !== password) {
      return Promise.reject(new AuthError("invalid_credentials"));
    }
    if (state.pending === email) {
      return Promise.reject(new AuthError("email_not_verified"));
    }
    state.signedIn = email;
    this.#write(state);
    return Promise.resolve();
  }

  signOut(): Promise<void> {
    const state = this.#read();
    state.signedIn = null;
    this.#write(state);
    return Promise.resolve();
  }

  requestPasswordReset(email: string): Promise<void> {
    const state = this.#read();
    state.resetFor = email;
    this.#write(state);
    return Promise.resolve();
  }

  /**
   * There is no email here, so asking for a reset stands in for opening the
   * link. Like a real link it works once, and only for an existing account.
   */
  completePasswordReset(newPassword: string): Promise<void> {
    const state = this.#read();
    const account = state.accounts.find(([email]) => email === state.resetFor);
    state.resetFor = null;
    if (account === undefined) {
      this.#write(state);
      return Promise.reject(new AuthError("reset_link_invalid"));
    }
    account[1] = newPassword;
    state.signedIn = null;
    this.#write(state);
    return Promise.resolve();
  }
}
