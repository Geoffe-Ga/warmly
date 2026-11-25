import { expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";

import { App } from "../../../src/app/App";
import { createLockHooks } from "../../../src/app/lock-hooks";
import { createOnboarding } from "../../../src/app/onboarding";
import type { Services } from "../../../src/app/services";
import { createSession, type SessionState } from "../../../src/app/session";
import { createRevocationSignal } from "../../../src/devices/revocation";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import { FakeDeviceDirectory } from "../../../src/testing/fake-device-directory";
import { FakeDevicePairing } from "../../../src/testing/fake-device-pairing";
import {
  FAKE_DEVICE_PASSPHRASE,
  FakeKeyVault,
} from "../../../src/testing/fake-key-vault";

/** Services built on the in-memory doubles, with the doubles exposed. */
export interface TestServices extends Services {
  readonly auth: FakeAuthClient;
  readonly vault: FakeKeyVault;
  readonly devices: FakeDeviceDirectory;
  readonly pairing: FakeDevicePairing;
}

/** Sample values for the `:id` segments of parameterised routes. */
export const SAMPLE_PARAMS = { id: "sample-1", cardId: "sample-2" };

// Assembled from words so no credential-shaped literal sits in the repository.
const SYNTHETIC_PHRASE = ["correct", "horse", "battery"].join(" ");

/** A synthetic account used across the account tests. Nothing here is real. */
export const ACCOUNT = {
  email: "sam@example.com",
  password: SYNTHETIC_PHRASE,
};

/**
 * Build services for a test.
 *
 * @param state - The session state to start in.
 * @returns Services backed by fresh doubles.
 */
export function testServices(state: SessionState = "signed_out"): TestServices {
  const vault = new FakeKeyVault();
  const revocation = createRevocationSignal();
  const devices = new FakeDeviceDirectory();
  devices.password = ACCOUNT.password;
  devices.onThisDeviceRevoked = revocation.report;
  return {
    auth: new FakeAuthClient(),
    vault,
    devices,
    revocation,
    forgetThisDevice: () => {
      vault.forgetThisDevice();
      return Promise.resolve();
    },
    pairing: new FakeDevicePairing(vault),
    session: createSession(state),
    onboarding: createOnboarding(),
    lockHooks: createLockHooks(),
  };
}

/**
 * Finish creating an account's keys, as onboarding does once the user has
 * confirmed the recovery key. Leaves the vault unlocked on a trusted device.
 *
 * @param vault - The vault double.
 */
export async function setUpKeys(vault: FakeKeyVault): Promise<void> {
  await vault.createAccountKeys();
  await vault.confirmRecoveryKey();
  await vault.trustThisDevice(FAKE_DEVICE_PASSPHRASE);
}

/** Point the browser at a path before the app renders. */
export function visit(path: string): void {
  window.history.replaceState(null, "", path);
}

/**
 * Render the app at a path and wait until it has finished starting up.
 *
 * @param path - Where to start.
 * @param services - Services to inject; defaults to a signed-out set.
 * @returns The services in use.
 */
export async function renderApp(
  path: string,
  services: TestServices = testServices(),
): Promise<TestServices> {
  visit(path);
  render(<App services={services} />);
  await waitFor(() => {
    expect(heading().textContent).not.toBe("Opening Warmly");
  });
  return services;
}

/** The screen's single page heading. */
export function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}
