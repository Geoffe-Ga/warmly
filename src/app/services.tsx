/**
 * The external services the app depends on, and how screens reach them.
 */
import { createContext } from "preact";
import { useContext } from "preact/hooks";

import {
  ApiRecoveryEnvelopeStore,
  type RecoveryEnvelopeStore,
} from "../api/recovery-envelope-store";
import { UnavailableAuthClient, type AuthClient } from "../auth/auth-client";
import {
  createSupabaseAuthClient,
  readSupabaseAuthConfig,
} from "../auth/supabase-auth-client";
import { AccountVault } from "../crypto/account-vault";
import type { DeviceKeyStore } from "../crypto/device-key-store";
import { UnavailableKeyVault, type KeyVault } from "../crypto/key-vault";
import { FakeAuthClient } from "../testing/fake-auth-client";
import { FakeDeviceKeyStore } from "../testing/fake-device-key-store";
import { FakeRecoveryEnvelopeStore } from "../testing/fake-recovery-envelope-store";
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
 * Choose the key vault for a build.
 *
 * With doubles available (every build but production), the real vault runs
 * on an in-memory "server" and device store, so the real cryptography is
 * exercised in development and in the browser tests. A production build
 * configured with a Supabase project gets the real vault on the Warmly API,
 * with no device store until trusted-device unlock lands (issue #20). An
 * unconfigured production build gets the "unavailable" stand-in.
 *
 * @param env - The build-time variables.
 * @param auth - The auth client the vault asks who is signed in.
 * @param doubles - The in-memory stores. Production builds pass nothing.
 * @returns The key vault.
 */
export function createKeyVault(
  env: Readonly<Record<string, unknown>>,
  auth: AuthClient,
  doubles?: {
    readonly envelopes: RecoveryEnvelopeStore;
    readonly device: DeviceKeyStore;
  },
): KeyVault {
  if (doubles !== undefined) {
    return new AccountVault(auth, doubles.envelopes, doubles.device);
  }
  const apiOrigin = env["VITE_API_ORIGIN"];
  // Both must be configured. Without the API's origin the vault would send
  // requests to the static host, so the app says keys are unavailable
  // instead of failing in a confusing way later.
  if (
    readSupabaseAuthConfig(env) === undefined ||
    typeof apiOrigin !== "string" ||
    apiOrigin === ""
  ) {
    return new UnavailableKeyVault();
  }
  return new AccountVault(
    auth,
    new ApiRecoveryEnvelopeStore(apiOrigin, (input, init) =>
      fetch(input, init),
    ),
  );
}

/**
 * Build the services for this build.
 *
 * `import.meta.env.MODE` is a compile-time constant. In a production build
 * the conditions below are `false`, so the bundler drops the in-memory
 * doubles from the bundle; a browser test checks the built files.
 *
 * @returns Fresh services with a signed-out session.
 */
export function createServices(): Services {
  const auth = createAuthClient(
    import.meta.env,
    import.meta.env.MODE !== "production"
      ? () => new FakeAuthClient()
      : undefined,
  );
  return {
    auth,
    vault: createKeyVault(
      import.meta.env,
      auth,
      import.meta.env.MODE !== "production"
        ? {
            envelopes: new FakeRecoveryEnvelopeStore(),
            device: new FakeDeviceKeyStore(),
          }
        : undefined,
    ),
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
