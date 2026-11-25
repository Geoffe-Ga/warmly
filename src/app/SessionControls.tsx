/**
 * The Lock and Sign out buttons in the header, and the one routine both use
 * to make sure no key material is left behind.
 */
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";

import { Button } from "../ui/components/Button";
import { LOCKED_PATH, SIGN_IN_PATH } from "./access";
import { watchInactivity } from "./inactivity";
import { useServices, type Services } from "./services";
import type { SessionState } from "./session";

/**
 * End the unlocked part of a session on this device: drop the keys from
 * memory and forget anything held for onboarding, such as an unconfirmed
 * recovery key. Used by both Lock and Sign out, so neither can leave key
 * material behind for whoever uses the device next.
 *
 * @param services - The app's services.
 */
export function dropSecrets(services: Services): void {
  services.vault.lock();
  services.onboarding.clear();
}

/**
 * Lock the app: let unsaved work be encrypted and saved, then drop the keys,
 * change the session and show the locked screen (PRD DEV-005).
 *
 * The keys are dropped even if saving fails or takes too long. If the session
 * is no longer unlocked by the time saving has finished, for example because
 * the user signed out meanwhile, nothing more is done.
 *
 * @param services - The app's services.
 * @param navigate - Moves to another in-app path.
 */
export function lockNow(
  services: Services,
  navigate: (path: string) => void,
): Promise<void> {
  // A second request while the first is still saving joins it, so unsaved
  // work is saved once and the app locks once.
  const underway = LOCKS_UNDERWAY.get(services);
  if (underway !== undefined) {
    return underway;
  }
  const locking = lockOnce(services, navigate).finally(() => {
    LOCKS_UNDERWAY.delete(services);
  });
  LOCKS_UNDERWAY.set(services, locking);
  return locking;
}

const LOCKS_UNDERWAY = new WeakMap<Services, Promise<void>>();

async function lockOnce(
  services: Services,
  navigate: (path: string) => void,
): Promise<void> {
  if (services.session.state !== "unlocked") {
    return;
  }
  await services.lockHooks.flush();
  if (services.session.state !== "unlocked") {
    return;
  }
  dropSecrets(services);
  services.session.lock();
  navigate(LOCKED_PATH);
}

/**
 * Lock the app after 30 minutes without input, for as long as it is unlocked.
 * A tab that was suspended past the limit locks as soon as it is seen again.
 *
 * @param services - The app's services.
 * @param state - The current session state.
 * @param navigate - Moves to another in-app path.
 */
export function useInactivityLock(
  services: Services,
  state: SessionState,
  navigate: (path: string) => void,
): void {
  useEffect(() => {
    if (state !== "unlocked") {
      return undefined;
    }
    const watch = watchInactivity({
      onIdle: () => {
        void lockNow(services, navigate);
      },
    });
    return () => {
      watch.stop();
    };
  }, [services, state, navigate]);
}

/**
 * Lock and Sign out. Shows nothing while signed out, and no Lock button
 * unless the app is unlocked.
 *
 * @param props - `navigate` moves to another in-app path.
 * @returns The buttons, or nothing.
 */
export function SessionControls(props: {
  readonly navigate: (path: string) => void;
}): JSX.Element | null {
  const services = useServices();
  const { auth, session } = services;
  if (session.state === "signed_out") {
    return null;
  }
  const signOut = (): void => {
    // Signing out on this device must always succeed, and at once. The keys
    // are dropped and the private screens close before the server is told,
    // so a slow or failed request never leaves them open. Unlike locking,
    // signing out does not wait for unsaved work.
    dropSecrets(services);
    session.signOut();
    props.navigate(SIGN_IN_PATH);
    // Telling the server is best effort: if it fails, for example while
    // offline, there is nothing more this device can do.
    auth.signOut().catch(() => undefined);
  };
  const lock = (): void => {
    void lockNow(services, props.navigate);
  };
  return (
    <div class="button-row">
      {session.state === "unlocked" && <Button onClick={lock}>Lock</Button>}
      <Button onClick={signOut}>Sign out</Button>
    </div>
  );
}
