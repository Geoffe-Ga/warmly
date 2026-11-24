/**
 * The external services the app depends on, and how screens reach them.
 */
import { createContext } from "preact";
import { useContext } from "preact/hooks";

import { UnavailableAuthClient, type AuthClient } from "../auth/auth-client";
import {
  createSupabaseAuthClient,
  readSupabaseAuthConfig,
} from "../auth/supabase-auth-client";
import { UnavailableKeyVault, type KeyVault } from "../crypto/key-vault";
import { FakeAuthClient } from "../testing/fake-auth-client";
import { FakeKeyVault } from "../testing/fake-key-vault";
import { createOnboarding, type Onboarding } from "./onboarding";
import { createSession, type Session } from "./session";

/** Everything a screen may use to act on the account. */
export interface Services {
  readonly auth: AuthClient;
  readonly vault: KeyVault;
  readonly session: Session;
  /** In-memory state of an account being set up; see {@link Onboarding}. */
  readonly onboarding: Onboarding;
}

/**
 * Choose the auth client for this build.
 *
 * A build configured with a Supabase project gets the real client. Without
 * one, a production build gets the "unavailable" stand-in, and every other
 * build (development, unit tests, the `e2e` build) gets the in-memory double.
 * The build mode is a compile-time constant, so the double is removed from
 * production bundles.
 *
 * @param env - The build-time variables.
 * @returns The auth client.
 */
export function createAuthClient(
  env: Readonly<Record<string, unknown>>,
): AuthClient {
  const config = readSupabaseAuthConfig(env);
  if (config !== undefined) {
    return createSupabaseAuthClient(config);
  }
  return import.meta.env.MODE !== "production"
    ? new FakeAuthClient()
    : new UnavailableAuthClient();
}

/**
 * Build the services for this build.
 *
 * The key vault is still a double outside production and "unavailable" in
 * production, until the real one lands (issues #19 and #20).
 *
 * @returns Fresh services with a signed-out session.
 */
export function createServices(): Services {
  return {
    auth: createAuthClient(import.meta.env),
    vault:
      import.meta.env.MODE !== "production"
        ? new FakeKeyVault()
        : new UnavailableKeyVault(),
    session: createSession(),
    onboarding: createOnboarding(),
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
