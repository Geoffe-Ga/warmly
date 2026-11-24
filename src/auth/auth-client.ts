/**
 * The account-authentication seam. Screens depend on this interface only, so
 * the real Supabase client (issue #18) replaces the stand-ins without touching
 * any screen.
 *
 * Authentication proves who the user is. It never unlocks their data: that
 * takes key material from the {@link KeyVault} (PRD DEV-006).
 */

/** Why an authentication request failed. */
export type AuthErrorCode =
  "invalid_credentials" | "email_not_verified" | "unavailable";

/** A failed authentication request, with a code the UI can explain. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(`Authentication failed: ${code}`);
    this.name = "AuthError";
    this.code = code;
  }
}

/** Email and password accounts with verification and reset. */
export interface AuthClient {
  /** Whether a signed-in session already exists, for example after a reload. */
  isSignedIn(): Promise<boolean>;
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
  signOut(): Promise<void>;
  /**
   * Send a password-reset email. Resolves the same way for any address.
   * Resetting a password never unlocks encrypted data.
   */
  requestPasswordReset(email: string): Promise<void>;
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
}
