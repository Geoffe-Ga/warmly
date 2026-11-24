/**
 * The account-authentication seam. Screens depend on this interface only, so
 * the real client (`supabase-auth-client.ts`), the in-memory double and the
 * "unavailable" stand-in are interchangeable.
 *
 * Authentication proves who the user is. It never unlocks their data: that
 * takes key material from the {@link KeyVault} (PRD DEV-006).
 */

/** Why an authentication request failed. */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_verified"
  | "weak_password"
  | "rate_limited"
  | "offline"
  | "reset_link_invalid"
  | "unavailable";

/** A failed authentication request, with a code the UI can explain. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(`Authentication failed: ${code}`);
    this.name = "AuthError";
    this.code = code;
  }
}

/** Who is signed in, and the credential the Warmly API accepts for them. */
export interface AuthSession {
  /** The account's ID. It is the owner every record is bound to. */
  readonly userId: string;
  /** A short-lived access token. Never store or log it. */
  readonly accessToken: string;
}

/** Email and password accounts with verification and reset. */
export interface AuthClient {
  /** Whether a signed-in session already exists, for example after a reload. */
  isSignedIn(): Promise<boolean>;
  /** The signed-in session, or `undefined` when signed out. */
  currentSession(): Promise<AuthSession | undefined>;
  /**
   * Create an account and send a verification email.
   *
   * Resolves the same way whether or not the address was already registered,
   * so the response never reveals who has an account.
   */
  register(email: string, password: string): Promise<void>;
  /**
   * Finish registration once the user has followed the emailed link.
   *
   * @returns `true` if the address is verified and the user is now signed in.
   */
  completeVerification(): Promise<boolean>;
  /** @throws AuthError `invalid_credentials` or `email_not_verified`. */
  signIn(email: string, password: string): Promise<void>;
  /**
   * End the session on this device. The local session is always removed,
   * whether or not the server could be told.
   */
  signOut(): Promise<void>;
  /**
   * Send a password-reset email. Resolves the same way for any address.
   * Resetting a password never unlocks encrypted data.
   */
  requestPasswordReset(email: string): Promise<void>;
  /**
   * Set a new password, using the reset link the user arrived by. Leaves the
   * user signed out, so they sign in with the new password.
   *
   * @throws AuthError `reset_link_invalid` if the page was not opened from a
   *   valid, unused link, or `weak_password`.
   */
  completePasswordReset(newPassword: string): Promise<void>;
}

/**
 * Stand-in used by production builds until the real client exists. Every
 * operation fails with `unavailable`, so the app says so plainly instead of
 * pretending to sign anyone in.
 */
export class UnavailableAuthClient implements AuthClient {
  isSignedIn(): Promise<boolean> {
    return Promise.resolve(false);
  }

  currentSession(): Promise<AuthSession | undefined> {
    return Promise.resolve(undefined);
  }

  register(): Promise<void> {
    return Promise.reject(new AuthError("unavailable"));
  }

  completeVerification(): Promise<boolean> {
    return Promise.reject(new AuthError("unavailable"));
  }

  signIn(): Promise<void> {
    return Promise.reject(new AuthError("unavailable"));
  }

  signOut(): Promise<void> {
    return Promise.resolve();
  }

  requestPasswordReset(): Promise<void> {
    return Promise.reject(new AuthError("unavailable"));
  }

  completePasswordReset(): Promise<void> {
    return Promise.reject(new AuthError("unavailable"));
  }
}
