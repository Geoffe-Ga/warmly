import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../../../src/api/client";
import { endRevokedDevice } from "../../../src/app/SessionControls";
import { PairingError } from "../../../src/devices/pairing";
import {
  FAKE_DEVICES,
  FakeDeviceDirectory,
} from "../../../src/testing/fake-device-directory";

import {
  ACCOUNT,
  heading,
  renderApp,
  setUpKeys,
  testServices,
  type TestServices,
} from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/** An unlocked, signed-in account on a trusted device. */
async function unlocked(): Promise<TestServices> {
  const services = testServices("signed_out");
  await services.auth.register(ACCOUNT.email, ACCOUNT.password);
  await services.auth.completeVerification();
  await setUpKeys(services.vault);
  services.session.signIn();
  services.session.unlock();
  return services;
}

async function openDevices(services: TestServices): Promise<TestServices> {
  await renderApp("/settings/devices", services);
  await screen.findByRole("heading", { level: 2, name: "Kitchen laptop" });
  return services;
}

function dialog(): HTMLElement {
  return screen.getByRole("alertdialog");
}

async function askToRemove(name: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
}

async function confirmWith(password: string): Promise<void> {
  if (password !== "") {
    await userEvent.type(
      within(dialog()).getByLabelText("Account password"),
      password,
    );
  }
  await userEvent.click(
    within(dialog()).getByRole("button", { name: "Remove device" }),
  );
}

describe("removing another device (DEV-003, DEV-004, AC-20)", () => {
  it("asks first, states the offline caveat honestly, and needs the account password", async () => {
    await openDevices(await unlocked());

    await askToRemove("Unnamed device");

    const text = dialog().textContent;
    expect(
      within(dialog()).getByRole("heading", {
        name: "Remove Unnamed device?",
      }),
    ).toBeTruthy();
    expect(text).toContain("It will stop syncing straight away");
    expect(text).toContain("This cannot be undone");
    expect(text).toContain("We cannot erase a device from here");
    expect(text).toContain("If it is offline, it keeps what it already has");
    expect(within(dialog()).getByLabelText("Account password")).toBeTruthy();
  });

  it("removes the device once the password is given, and shows it as removed", async () => {
    const services = await openDevices(await unlocked());
    await askToRemove("Unnamed device");

    await confirmWith(ACCOUNT.password);

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(
      (
        await screen.findByText(
          "That device can no longer sync or open your journal.",
        )
      ).getAttribute("role"),
    ).toBe("status");
    // The list reloads; the card then says so and offers nothing more.
    const removed = (await screen.findByText("Removed.")).closest(
      "section",
    ) as HTMLElement;
    expect(
      within(removed).getByRole("heading", { name: "Unnamed device" }),
    ).toBeTruthy();
    expect(within(removed).queryByRole("button")).toBeNull();
    expect((await services.devices.list())[1]?.revoked).toBe(true);
    expect(services.session.state).toBe("unlocked");
  });

  it("removes nothing without a password, and says what is needed", async () => {
    const services = await openDevices(await unlocked());
    await askToRemove("Unnamed device");

    await confirmWith("");

    const field = within(dialog()).getByLabelText("Account password");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(
      within(dialog()).getByText("Enter your account password to confirm."),
    ).toBeTruthy();
    expect((await services.devices.list())[1]?.revoked).toBe(false);
  });

  it("a wrong password removes nothing and can be corrected", async () => {
    const services = await openDevices(await unlocked());
    await askToRemove("Unnamed device");

    await confirmWith("not the password");

    expect((await within(dialog()).findByRole("alert")).textContent).toContain(
      "don't match",
    );
    expect((await services.devices.list())[1]?.revoked).toBe(false);

    const field = within(dialog()).getByLabelText("Account password");
    await userEvent.clear(field);
    await confirmWith(ACCOUNT.password);
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect((await services.devices.list())[1]?.revoked).toBe(true);
  });

  it("cancelling removes nothing", async () => {
    const services = await openDevices(await unlocked());
    await askToRemove("Unnamed device");

    await userEvent.click(
      within(dialog()).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await services.devices.list())[1]?.revoked).toBe(false);
    expect(screen.queryByText("Removed.")).toBeNull();
  });

  it("shows a device that was already removed without any actions", async () => {
    const services = await unlocked();
    await renderApp("/settings/devices", {
      ...services,
      devices: new FakeDeviceDirectory([
        FAKE_DEVICES[0] as (typeof FAKE_DEVICES)[0],
        { ...(FAKE_DEVICES[1] as (typeof FAKE_DEVICES)[1]), revoked: true },
      ]),
    });

    const removed = (
      await screen.findByRole("heading", { level: 2, name: "Unnamed device" })
    ).closest("section") as HTMLElement;

    expect(within(removed).getByText("Removed.")).toBeTruthy();
    expect(within(removed).queryByRole("button")).toBeNull();
    expect(within(removed).queryByText("Last synced")).toBeNull();
  });
});

describe("removing the device in use (AC-20)", () => {
  it("warns that this device will be signed out, then ends the session without showing private data", async () => {
    const services = await openDevices(await unlocked());
    await askToRemove("Kitchen laptop");
    expect(dialog().textContent).toContain(
      "This is the device you are using. It will be signed out now",
    );

    await confirmWith(ACCOUNT.password);

    await waitFor(() => {
      expect(heading().textContent).toBe("This device was removed");
    });
    expect(services.session.state).toBe("signed_out");
    expect(services.vault.isUnlocked).toBe(false);
    expect(await services.vault.hasKeysOnThisDevice()).toBe(false);
    expect(await services.auth.isSignedIn()).toBe(false);
    expect(screen.queryByText("Kitchen laptop")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.location.pathname).toBe("/removed");
  });
});

describe("a device that finds out it was removed (DEV-003, DEV-004)", () => {
  it("is signed out and told what happened when any request is refused as revoked", async () => {
    const services = await unlocked();
    services.devices.failNextWith = new ApiError("device_revoked");
    await renderApp("/settings/devices", services);

    // The request that found out reports it, as the API client does.
    services.revocation.report();

    await waitFor(() => {
      expect(heading().textContent).toBe("This device was removed");
    });
    expect(services.session.state).toBe("signed_out");
    expect(services.vault.isUnlocked).toBe(false);
    expect(await services.vault.hasKeysOnThisDevice()).toBe(false);
  });

  it("says honestly what is still on the device, and how to come back", async () => {
    await renderApp("/removed");

    const text = document.body.textContent;
    expect(text).toContain("It was removed from your account");
    expect(text).toContain("can no longer sync");
    expect(text).toContain("Its keys have been deleted from this browser");
    expect(text).toContain("still stored in this browser, encrypted");
    expect(text).toContain("Nothing was erased");
    expect(text).toContain("clear this site's data");
    expect(text).toContain("It will join as a new device");
    expect(text).toContain("If you didn't do this");
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/sign-in");
  });

  it("lets unsaved work be saved before the keys are dropped", async () => {
    const services = await unlocked();
    const order: string[] = [];
    services.lockHooks.register(() => {
      order.push(services.vault.isUnlocked ? "saved with keys" : "too late");
      return Promise.resolve();
    });

    await endRevokedDevice(services, (path) => {
      order.push(path);
    });

    expect(order).toEqual(["saved with keys", "/removed"]);
    expect(services.session.state).toBe("signed_out");
  });

  it("still ends the session when saving or forgetting fails", async () => {
    const services = await unlocked();
    services.lockHooks.register(() => Promise.reject(new Error("disk full")));
    const failing = {
      ...services,
      forgetThisDevice: () => Promise.reject(new Error("storage blocked")),
    };
    let landed = "";

    await endRevokedDevice(failing, (path) => {
      landed = path;
    });

    expect(landed).toBe("/removed");
    expect(services.session.state).toBe("signed_out");
    expect(services.vault.isUnlocked).toBe(false);
  });

  it("handles a locked device the same way, and does nothing once signed out", async () => {
    const services = await unlocked();
    services.session.lock();
    services.vault.lock();
    const visited: string[] = [];
    const navigate = (path: string): void => {
      visited.push(path);
    };

    await endRevokedDevice(services, navigate);
    await endRevokedDevice(services, navigate);

    expect(visited).toEqual(["/removed"]);
    expect(services.session.state).toBe("signed_out");
    expect(await services.vault.hasKeysOnThisDevice()).toBe(false);
  });

  it("ends the device once when several requests find out together", async () => {
    const services = await unlocked();
    const visited: string[] = [];
    const navigate = (path: string): void => {
      visited.push(path);
    };

    await Promise.all([
      endRevokedDevice(services, navigate),
      endRevokedDevice(services, navigate),
      endRevokedDevice(services, navigate),
    ]);

    expect(visited).toEqual(["/removed"]);
  });

  it("the removed screen is not shown to a signed-in user", async () => {
    await renderApp("/removed", await unlocked());

    expect(heading().textContent).not.toBe("This device was removed");
  });
});

describe("approving a device: refusing can fail (carried from the pairing review)", () => {
  it("says so when the refusal could not be sent", async () => {
    const services = await unlocked();
    services.pairing.requestWaiting = true;
    const takeUp = services.pairing.takeUpRequest.bind(services.pairing);
    services.pairing.takeUpRequest = async () => {
      const approval = await takeUp();
      return approval === undefined
        ? undefined
        : {
            ...approval,
            reject: () => Promise.reject(new PairingError("pairing_expired")),
          };
    };
    await renderApp("/settings/devices/approve", services);
    await userEvent.click(
      await screen.findByRole("button", { name: "Look for a new device" }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Don't approve" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Not approved");
    expect(alert.textContent).toContain("ran out of time");
    expect(screen.queryByLabelText("Code on the new device")).toBeNull();
  });
});
