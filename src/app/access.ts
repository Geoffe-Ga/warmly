/**
 * Which screens each session state may show (PRD DEV-005, UI-008).
 *
 * The rule is decided here and nowhere else. A screen never checks the session
 * itself; if it is rendered, it is allowed to be.
 */
import type { RouteAccess } from "./routes";
import type { SessionState } from "./session";

/** Where a signed-out visitor is sent. */
export const SIGN_IN_PATH = "/sign-in";
/** Where a signed-in visitor whose data is locked is sent. */
export const LOCKED_PATH = "/locked";
/** Where an unlocked visitor is sent from screens they no longer need. */
export const HOME_PATH = "/";

const REDIRECTS: Readonly<
  Record<RouteAccess, Readonly<Record<SessionState, string | undefined>>>
> = {
  // Sign-in and registration screens: pointless once signed in.
  public: {
    signed_out: undefined,
    signed_in_locked: LOCKED_PATH,
    unlocked: HOME_PATH,
  },
  // Unlock and recovery screens: need a signed-in user whose data is locked.
  locked: {
    signed_out: SIGN_IN_PATH,
    signed_in_locked: undefined,
    unlocked: HOME_PATH,
  },
  // Everything that can show private content.
  private: {
    signed_out: SIGN_IN_PATH,
    signed_in_locked: LOCKED_PATH,
    unlocked: undefined,
  },
};

/**
 * Decide whether a screen may be shown.
 *
 * @param access - The access level of the requested route.
 * @param state - The current session state.
 * @returns The path to send the visitor to instead, or `undefined` if the
 *   screen may be shown.
 */
export function redirectFor(
  access: RouteAccess,
  state: SessionState,
): string | undefined {
  return REDIRECTS[access][state];
}
