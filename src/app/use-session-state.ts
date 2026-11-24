import { useEffect, useState } from "preact/hooks";

import type { Services } from "./services";
import type { SessionState } from "./session";

/** What {@link useSessionState} reports. */
export interface SessionStatus {
  /** The current session state, kept up to date. */
  readonly state: SessionState;
  /** False until the app knows whether a signed-in session was restored. */
  readonly ready: boolean;
}

/**
 * Follow the session state and, once on start-up, restore a signed-in
 * session.
 *
 * A reload keeps the user signed in but never unlocked, because keys live
 * only in memory. If the session cannot be restored the app starts signed
 * out: failing closed is the safe reading of "unknown".
 *
 * @param services - The app's services.
 * @returns The session state and whether start-up has finished.
 */
export function useSessionState(services: Services): SessionStatus {
  const { auth, session } = services;
  const [state, setState] = useState(session.state);
  const [ready, setReady] = useState(false);

  useEffect(() => session.subscribe(setState), [session]);

  useEffect(() => {
    let cancelled = false;
    const finish = (signedIn: boolean): void => {
      if (cancelled) {
        return;
      }
      if (signedIn && session.state === "signed_out") {
        session.signIn();
      }
      setReady(true);
    };
    auth.isSignedIn().then(finish, () => {
      finish(false);
    });
    return () => {
      cancelled = true;
    };
  }, [auth, session]);

  return { state, ready };
}
