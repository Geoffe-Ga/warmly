/**
 * The external services the app depends on, and how screens reach them.
 */
import { createContext } from "preact";
import { useContext } from "preact/hooks";

import { ApiClient } from "../api/client";
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
import {
  IndexedDbDeviceKeyStore,
  type DeviceKeyStore,
} from "../crypto/device-key-store";
import { UnavailableKeyVault, type KeyVault } from "../crypto/key-vault";
import {
  IndexedDbDeviceIdentityStore,
  type DeviceIdentityStore,
} from "../devices/identity";
import {
  AccountPairing,
  UnavailableDevicePairing,
  type DevicePairing,
} from "../devices/pairing";
import { ApiPairingRelay, type PairingRelay } from "../devices/pairing-relay";
import { ApiDeviceRegistry, type DeviceRegistry } from "../devices/registry";
import {
  createRevocationSignal,
  type RevocationSignal,
} from "../devices/revocation";
import {
  AccountDevices,
  UnavailableDeviceDirectory,
  type DeviceDirectory,
} from "../devices/this-device";
import type { RootKey } from "../crypto/root-key";
import { recordsDatabaseName } from "../storage/db";
import { EncryptedRecordStore } from "../storage/encrypted-record-store";
import {
  browserPersistence,
  type StoragePersistence,
} from "../storage/persistence";
import type { RecordStore } from "../storage/record-store";
import { SyncEngine, type SyncControl } from "../sync/engine";
import { SyncScheduler, tabExclusive } from "../sync/scheduler";
import { MemoryServer } from "../sync/testing/memory-server";
import {
  ApiSyncTransport,
  SyncUnavailableError,
  UNAVAILABLE_TRANSPORT,
  type SyncTransport,
} from "../sync/transport";
import { FakeAuthClient } from "../testing/fake-auth-client";
import { FakeDeviceRegistry } from "../testing/fake-device-registry";
import { FakePairingRelay } from "../testing/fake-pairing-relay";
import { FakeRecoveryEnvelopeStore } from "../testing/fake-recovery-envelope-store";
import { createEventBus, type EventBus } from "../domain/events";
import { createLockHooks, type LockHooks } from "./lock-hooks";
import { createOnboarding, type Onboarding } from "./onboarding";
import { createSession, type Session } from "./session";

/** Everything a screen may use to act on the account. */
export interface Services {
  readonly auth: AuthClient;
  readonly vault: KeyVault;
  /** The account's own devices, for Manage Devices. */
  readonly devices: DeviceDirectory;
  /** Handing the account key from an unlocked device to a new one. */
  readonly pairing: DevicePairing;
  /** See {@link KeyServices.forgetThisDevice}. */
  readonly forgetThisDevice: () => Promise<void>;
  /** Reports that the server has refused this device as revoked. */
  readonly revocation: RevocationSignal;
  /** The private records: journal entries now, more kinds later. */
  readonly records: RecordStore;
  readonly session: Session;
  /** In-memory state of an account being set up; see {@link Onboarding}. */
  readonly onboarding: Onboarding;
  /** Work to finish before the app locks; see {@link LockHooks}. */
  readonly lockHooks: LockHooks;
  /** Sends local changes to the server and fetches remote ones. */
  readonly sync: SyncControl;
  /** Asks the browser to keep this device's data, and reports the answer. */
  readonly persistence: StoragePersistence;
  /** Announces changes to private records; see {@link EventBus}. */
  readonly events: EventBus;
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

/** The in-memory stand-ins for the Warmly API and this device's storage. */
export interface KeyServiceDoubles {
  readonly envelopes: RecoveryEnvelopeStore;
  readonly device: DeviceKeyStore;
  readonly identities: DeviceIdentityStore;
  readonly registry: DeviceRegistry;
  readonly relay: PairingRelay;
  readonly sync: SyncTransport;
}

/** The services that need the account's keys. */
export interface KeyServices {
  readonly vault: KeyVault;
  readonly devices: DeviceDirectory;
  readonly pairing: DevicePairing;
  /**
   * Delete what makes this device able to unlock and to sign requests for
   * the signed-in account: its wrapped root key and its device key. Used
   * when the device has been revoked.
   */
  readonly forgetThisDevice: () => Promise<void>;
  /** How the sync engine reaches the server in this build. */
  readonly syncTransport: SyncTransport;
}

/**
 * Choose the key vault and the device directory for a build.
 *
 * With doubles available (every build but production), the real vault runs
 * on an in-memory "server", so the real cryptography and the real device
 * stores are exercised in development and in the browser tests. A production
 * build configured with a Supabase project gets the real vault on the Warmly
 * API. An unconfigured production build gets the "unavailable" stand-ins.
 *
 * @param env - The build-time variables.
 * @param auth - The auth client that says who is signed in.
 * @param doubles - The in-memory stores. Production builds pass nothing.
 * @param onDeviceRevoked - Called when the server refuses this device as
 *   revoked, or when the device revokes itself.
 * @param onUnlock - Called each time the vault is unlocked, with the root
 *   key and the account it belongs to. It must not throw.
 * @returns The key vault and the device directory.
 */
export function createKeyServices(
  env: Readonly<Record<string, unknown>>,
  auth: AuthClient,
  doubles?: KeyServiceDoubles,
  onDeviceRevoked: () => void = () => undefined,
  onUnlock: OnUnlock = () => undefined,
): KeyServices {
  if (doubles !== undefined) {
    return assemble(auth, doubles, onDeviceRevoked, onUnlock);
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
    return {
      vault: new UnavailableKeyVault(),
      devices: new UnavailableDeviceDirectory(),
      pairing: new UnavailableDevicePairing(),
      forgetThisDevice: () => Promise.resolve(),
      syncTransport: UNAVAILABLE_TRANSPORT,
    };
  }
  const api = new ApiClient(
    apiOrigin,
    (input, init) => fetch(input, init),
    () => Date.now(),
    onDeviceRevoked,
  );
  const identities = new IndexedDbDeviceIdentityStore();
  return assemble(
    auth,
    {
      envelopes: new ApiRecoveryEnvelopeStore(api, identities),
      device: new IndexedDbDeviceKeyStore(),
      identities,
      registry: new ApiDeviceRegistry(api),
      relay: new ApiPairingRelay(api),
      sync: new ApiSyncTransport(api, auth, identities),
    },
    onDeviceRevoked,
    onUnlock,
  );
}

/** Told each time the vault is unlocked. */
export type OnUnlock = (root: RootKey, owner: string) => void;

/**
 * Join the vault, the device directory and pairing: each unlock registers
 * the device if it is not registered yet, the directory reads the root key
 * from the vault, and pairing releases and accepts the key through it.
 */
function assemble(
  auth: AuthClient,
  parts: KeyServiceDoubles,
  onDeviceRevoked: () => void,
  onUnlock: OnUnlock,
): KeyServices {
  const vault: AccountVault = new AccountVault(
    auth,
    parts.envelopes,
    parts.device,
    (root, owner) => {
      onUnlock(root, owner);
      devices.registerInBackground(root);
    },
  );
  const devices = new AccountDevices(
    auth,
    parts.identities,
    parts.registry,
    () => vault.rootKey(),
    () => new Date(),
    onDeviceRevoked,
  );
  return {
    vault,
    devices,
    pairing: new AccountPairing(auth, parts.identities, parts.relay, vault),
    syncTransport: parts.sync,
    forgetThisDevice: async () => {
      const session = await auth.currentSession();
      if (session !== undefined) {
        await parts.device.forget(session.userId);
        await parts.identities.forget(session.userId);
      }
    },
  };
}

const TAB_ID_KEY = "warmly.fake.tab";

/**
 * The device-store database for this tab, in builds that use the in-memory
 * "server". Each tab gets its own, so a second tab behaves like a second
 * device: IndexedDB is otherwise shared by every tab. Production uses one
 * database for the whole browser.
 *
 * The only thing kept in `sessionStorage` here is a random tab ID. It is not
 * key material and decrypts nothing, and this function is not called in
 * production builds.
 *
 * @returns The database name.
 */
export function tabDeviceDatabase(): string {
  return `warmly-device-${tabId()}`;
}

/**
 * The device-identity database for this tab; see {@link tabDeviceDatabase}.
 *
 * @returns The database name.
 */
export function tabIdentityDatabase(): string {
  return `warmly-identity-${tabId()}`;
}

/**
 * The prefix of the records database for this tab; see
 * {@link tabDeviceDatabase}.
 *
 * @returns The prefix.
 */
export function tabRecordsPrefix(): string {
  return `warmly-${tabId()}`;
}

function tabId(): string {
  let tab = sessionStorage.getItem(TAB_ID_KEY);
  if (tab === null) {
    tab = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, tab);
  }
  return tab;
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
  const revocation = createRevocationSignal();
  // `navigator.storage` is missing on an insecure page and in old browsers.
  const persistence = browserPersistence(
    (navigator as Partial<Navigator>).storage,
  );
  const databaseName = (owner: string): string =>
    import.meta.env.MODE !== "production"
      ? recordsDatabaseName(owner, tabRecordsPrefix())
      : recordsDatabaseName(owner);
  const records = new EncryptedRecordStore(databaseName);
  const auth = createAuthClient(
    import.meta.env,
    import.meta.env.MODE !== "production"
      ? () => new FakeAuthClient()
      : undefined,
  );
  const { syncTransport, ...keys } = createKeyServices(
    import.meta.env,
    auth,
    import.meta.env.MODE !== "production"
      ? {
          envelopes: new FakeRecoveryEnvelopeStore(),
          device: new IndexedDbDeviceKeyStore(tabDeviceDatabase()),
          identities: new IndexedDbDeviceIdentityStore(tabIdentityDatabase()),
          registry: new FakeDeviceRegistry(
            localStorage,
            () => new Date(),
            revocation.report,
          ),
          relay: new FakePairingRelay(),
          // A server that lives only in this page: the real protocol with
          // nothing leaving the browser.
          sync: new MemoryServer().transportFor(async () => {
            const session = await auth.currentSession();
            if (session === undefined) {
              throw new SyncUnavailableError();
            }
            return session.userId;
          }),
        }
      : undefined,
    revocation.report,
    (root, owner) => {
      records.unlock(root, owner);
      // Once there is something worth keeping, ask the browser to keep
      // it. The answer is shown in Settings; it never rejects.
      void persistence.request();
      syncLock = `warmly-sync:${databaseName(owner)}`;
      sync.start();
    },
  );
  // One tab at a time syncs a local database (ADR-0006). Each account has
  // its own database, so each has its own lock.
  let syncLock = "warmly-sync";
  const sync = new SyncScheduler(
    new SyncEngine(
      records,
      syncTransport,
      () => navigator.onLine,
      // `navigator.locks` is missing on an insecure page and in old browsers.
      tabExclusive((navigator as Partial<Navigator>).locks, () => syncLock),
    ),
  );
  return {
    auth,
    ...keys,
    revocation,
    records,
    sync,
    persistence,
    session: createSession(),
    onboarding: createOnboarding(),
    lockHooks: createLockHooks(),
    events: createEventBus(),
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
