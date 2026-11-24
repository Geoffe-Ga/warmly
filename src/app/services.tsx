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
 * Choose the auth client for a build.
 *
 * The `e2e` build always gets the in-memory double, whatever is configured,
 * so the browser tests can never reach a real auth service. Otherwise a build
 * configured with a Supabase project gets the real client. Without one, the
 * double is used where there is one, and the "unavailable" stand-in where
 * there is not.
 *
 * @param env - The build-time variables, including `MODE`.
 * @param makeDouble - Builds the in-memory double. Production builds pass
 *   nothing, which is how the double stays out of the production bundle.
 * @returns The auth client.
 */
export function createAuthClient(
  env: Readonly<Record<string, unknown>>,
  makeDouble?: () => AuthClient,
): AuthClient {
  if (makeDouble !== undefined && env["MODE"] === "e2e") {
    return makeDouble();
  }
  const config = readSupabaseAuthConfig(env);
  if (config !== undefined) {
    return createSupabaseAuthClient(config);
  }
  return makeDouble === undefined ? new UnavailableAuthClient() : makeDouble();
}

/**
 * Build the services for this build.
 *
 * `import.meta.env.MODE` is a compile-time constant. In a production build
 * the conditions below are `false`, so the bundler drops the in-memory
 * doubles from the bundle; a browser test checks the built files. The key
 * vault is "unavailable" in production until the real one lands (issues #19
 * and #20).
 *
 * @returns Fresh services with a signed-out session.
 */
export function createServices(): Services {
  return {
    auth: createAuthClient(
      import.meta.env,
      import.meta.env.MODE !== "production"
        ? () => new FakeAuthClient()
        : undefined,
    ),
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
