/**
 * The external services the app depends on, and how screens reach them.
 */
import { createContext } from "preact";
import { useContext } from "preact/hooks";

import { UnavailableAuthClient, type AuthClient } from "../auth/auth-client";
import { UnavailableKeyVault, type KeyVault } from "../crypto/key-vault";
import { FakeAuthClient } from "../testing/fake-auth-client";
import { FakeKeyVault } from "../testing/fake-key-vault";
import { createSession, type Session } from "./session";

/** Everything a screen may use to act on the account. */
export interface Services {
  readonly auth: AuthClient;
  readonly vault: KeyVault;
  readonly session: Session;
  /**
   * State that lives only for the length of onboarding. The recovery key is
   * held here, in memory, between being created and being confirmed. It is
   * never written to storage.
   */
  readonly onboarding: { recoveryKey: string | undefined };
}

/**
 * Build the services for this build.
 *
 * The build mode is a compile-time constant. In a production build the
 * condition is `false`, so the in-memory doubles are removed from the bundle
 * and the app uses the "unavailable" stand-ins until the real clients land
 * (issues #18 and #20). Development, unit tests and the `e2e` build get the
 * doubles.
 *
 * @returns Fresh services with a signed-out session.
 */
export function createServices(): Services {
  if (import.meta.env.MODE !== "production") {
    return {
      auth: new FakeAuthClient(),
      vault: new FakeKeyVault(),
      session: createSession(),
      onboarding: { recoveryKey: undefined },
    };
  }
  return {
    auth: new UnavailableAuthClient(),
    vault: new UnavailableKeyVault(),
    session: createSession(),
    onboarding: { recoveryKey: undefined },
  };
}

const ServicesContext = createContext<Services | undefined>(undefined);

/** Provides {@link Services} to the screens below it. */
export const ServicesProvider = ServicesContext.Provider;

/**
 * Read the services from context.
 *
 * @returns The services.
 * @throws Error when rendered outside a {@link ServicesProvider}, which is a
 *   programming mistake worth failing loudly on.
 */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === undefined) {
    throw new Error("useServices must be used inside a ServicesProvider");
  }
  return services;
}
