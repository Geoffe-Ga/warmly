/**
 * The Lock and Sign out buttons in the header, and the one routine both use
 * to make sure no key material is left behind.
 */
import type { JSX } from "preact";

import { Button } from "../ui/components/Button";
import { LOCKED_PATH, SIGN_IN_PATH } from "./access";
import { useServices, type Services } from "./services";

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
    // so a slow or failed request never leaves them open.
    dropSecrets(services);
    session.signOut();
    props.navigate(SIGN_IN_PATH);
    // Telling the server is best effort: if it fails, for example while
    // offline, there is nothing more this device can do.
    auth.signOut().catch(() => undefined);
  };
  const lock = (): void => {
    dropSecrets(services);
    session.lock();
    props.navigate(LOCKED_PATH);
  };
  return (
    <div class="button-row">
      {session.state === "unlocked" && <Button onClick={lock}>Lock</Button>}
      <Button onClick={signOut}>Sign out</Button>
    </div>
  );
}
