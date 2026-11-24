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
  /** Registered accounts: email to password. Synthetic values only. */
  accounts: Record<string, string>;
  /** The address awaiting verification, if any. */
  pending: string | null;
  /** The signed-in address, if any. */
  signedIn: string | null;
}

const EMPTY: FakeAuthState = { accounts: {}, pending: null, signedIn: null };

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
    // An existing account is left untouched, and the caller cannot tell.
    state.accounts[email] ??= password;
    state.pending = email;
    this.#write(state);
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
    if (state.accounts[email] !== password) {
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

  requestPasswordReset(): Promise<void> {
    return Promise.resolve();
  }
}
