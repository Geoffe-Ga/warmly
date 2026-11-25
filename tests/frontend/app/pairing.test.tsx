import { cleanup, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../../../src/api/client";
import {
  FAKE_DEVICE_PASSPHRASE,
  FAKE_RECOVERY_KEY,
} from "../../../src/testing/fake-key-vault";

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

async function press(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name }));
}

async function fill(label: string, value: string): Promise<void> {
  await userEvent.type(await screen.findByLabelText(label), value);
}

/** A signed-in account with keys, locked, on a device with no stored key. */
async function newDevice(): Promise<TestServices> {
  const services = testServices("signed_out");
  await services.auth.register(ACCOUNT.email, ACCOUNT.password);
  await services.auth.completeVerification();
  await setUpKeys(services.vault);
  services.vault.lock();
  services.vault.forgetThisDevice();
  services.session.signIn();
  return services;
}

/** An unlocked account on a trusted device. */
async function unlockedDevice(trusted = true): Promise<TestServices> {
  const services = testServices("signed_out");
  await services.auth.register(ACCOUNT.email, ACCOUNT.password);
  await services.auth.completeVerification();
  await setUpKeys(services.vault);
  if (!trusted) {
    services.vault.forgetThisDevice();
  }
  services.session.signIn();
  services.session.unlock();
  return services;
}

describe("a new device asks to be approved (DEV-001 path A, AC-19)", () => {
  it("is offered on the recovery screen", async () => {
    await renderApp("/recover", await newDevice());

    const link = screen.getByRole("link", {
      name: "Approve from another device instead",
    });

    expect(link.getAttribute("href")).toBe("/recover/another-device");
  });

  it("does nothing until asked, then waits, shows the code and unlocks", async () => {
    const services = await renderApp(
      "/recover/another-device",
      await newDevice(),
    );
    expect(heading().textContent).toBe("Approve from another device");
    expect(services.pairing.joins).toBe(0);

    await press("Show a code");
    expect(
      (await screen.findByText(/open Manage Devices and choose/)).closest(
        '[role="status"]',
      ),
    ).not.toBeNull();
    expect(screen.queryByTestId("pairing-code")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show a code" })).toBeNull();

    services.pairing.otherDeviceMovesOn();
    const code = await screen.findByTestId("pairing-code");
    expect(code.textContent).toBe("042 917");
    // Read out digit by digit, not as a number in the hundreds of thousands.
    expect(code.getAttribute("aria-label")).toBe("Code: 0 4 2 9 1 7");
    expect(services.session.state).toBe("signed_in_locked");

    services.pairing.otherDeviceMovesOn();
    await waitFor(() => {
      expect(heading().textContent).toBe("Unlock this device more easily");
    });
    expect(services.session.state).toBe("unlocked");
    expect(services.vault.isUnlocked).toBe(true);
    expect(services.pairing.joins).toBe(1);
  });

  it.each([
    ["pairing_rejected", "didn't approve this request"],
    ["pairing_expired", "ran out of time"],
    ["pairing_tampered", "changed the messages between your two devices"],
  ] as const)(
    "explains %s, stays locked and can start again",
    async (code, text) => {
      const services = await renderApp(
        "/recover/another-device",
        await newDevice(),
      );
      await press("Show a code");
      await screen.findByText(/open Manage Devices and choose/);

      services.pairing.otherDeviceEndsItWith(code);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(text);
      expect(alert.textContent).toContain("Nothing was shared");
      expect(services.session.state).toBe("signed_in_locked");
      expect(services.vault.isUnlocked).toBe(false);

      await press("Start again");
      await screen.findByText(/open Manage Devices and choose/);
      expect(services.pairing.joins).toBe(2);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("starts only one request however often the button is pressed", async () => {
    const services = await renderApp(
      "/recover/another-device",
      await newDevice(),
    );
    const button = await screen.findByRole("button", { name: "Show a code" });

    await Promise.all([userEvent.click(button), userEvent.click(button)]);

    await screen.findByText(/open Manage Devices and choose/);
    expect(services.pairing.joins).toBe(1);
  });

  it("ends the request quietly when the screen is left", async () => {
    const services = await renderApp(
      "/recover/another-device",
      await newDevice(),
    );
    await press("Show a code");
    await screen.findByText(/open Manage Devices and choose/);

    await userEvent.click(
      screen.getByRole("link", { name: "Use your recovery key instead" }),
    );

    await waitFor(() => {
      expect(heading().textContent).toBe("Unlock with your recovery key");
    });
    expect(screen.queryByRole("alert")).toBeNull();
    // The abandoned pairing can no longer unlock anything.
    services.pairing.otherDeviceMovesOn();
    expect(services.vault.isUnlocked).toBe(false);
  });

  it("locks again if the session ended while the key was on its way", async () => {
    const services = await renderApp(
      "/recover/another-device",
      await newDevice(),
    );
    await press("Show a code");
    await screen.findByText(/open Manage Devices and choose/);
    services.pairing.otherDeviceMovesOn();
    await screen.findByTestId("pairing-code");

    services.session.signOut();
    services.pairing.otherDeviceMovesOn();

    await waitFor(() => {
      expect(services.vault.isUnlocked).toBe(false);
    });
    expect(services.session.state).toBe("signed_out");
  });

  it.each(["signed_out", "unlocked"] as const)(
    "is not shown while %s",
    async (state) => {
      await renderApp("/recover/another-device", testServices(state));

      expect(heading().textContent).not.toBe("Approve from another device");
    },
  );
});

describe("an unlocked device approves a new one (DEV-001 path A, AC-19)", () => {
  async function openApproval(
    services: TestServices,
    waiting = true,
  ): Promise<TestServices> {
    services.pairing.requestWaiting = waiting;
    await renderApp("/settings/devices/approve", services);
    expect(heading().textContent).toBe("Approve a new device");
    return services;
  }

  it("says so when no device is waiting, and can look again", async () => {
    const services = await openApproval(await unlockedDevice(), false);

    await press("Look for a new device");
    expect(
      (await screen.findByText(/press Show a code/, { selector: "div *,div" }))
        .textContent,
    ).toContain("look again here");
    expect(screen.queryByLabelText("Code on the new device")).toBeNull();

    services.pairing.requestWaiting = true;
    await press("Look again");

    expect(await screen.findByLabelText("Code on the new device")).toBeTruthy();
  });

  it("approves with the typed code and this device's passphrase", async () => {
    const services = await openApproval(await unlockedDevice());
    await press("Look for a new device");

    await fill("Code on the new device", "042 917");
    await fill("This device's passphrase", FAKE_DEVICE_PASSPHRASE);
    await press("Approve this device");

    expect(
      (await screen.findByText(/can now open your journal/)).getAttribute(
        "role",
      ),
    ).toBe("status");
    expect(services.pairing.outcome).toBe("approved");
    expect(screen.queryByLabelText("Code on the new device")).toBeNull();
    expect(screen.queryByRole("button", { name: /Look/ })).toBeNull();
  });

  it("asks for the recovery key on a device that is not trusted", async () => {
    const services = await openApproval(await unlockedDevice(false));
    await press("Look for a new device");

    await fill("Code on the new device", "042917");
    await fill("Recovery key", FAKE_RECOVERY_KEY);
    await press("Approve this device");

    await screen.findByText(/can now open your journal/);
    expect(services.pairing.outcome).toBe("approved");
    expect(screen.queryByLabelText("This device's passphrase")).toBeNull();
  });

  it("warns before approving, and never shows the code itself", async () => {
    await openApproval(await unlockedDevice());
    await press("Look for a new device");

    expect(
      await screen.findByText(/Only approve a device you are holding/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("042");
  });

  it("a wrong code cancels the request and says nothing was shared", async () => {
    const services = await openApproval(await unlockedDevice());
    await press("Look for a new device");

    await fill("Code on the new device", "111111");
    await fill("This device's passphrase", FAKE_DEVICE_PASSPHRASE);
    await press("Approve this device");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("isn't the code on the new device");
    expect(alert.textContent).toContain("Nothing was shared");
    expect(services.pairing.outcome).toBe("rejected");
    expect(screen.queryByLabelText("Code on the new device")).toBeNull();
    expect(screen.getByRole("button", { name: "Look again" })).toBeTruthy();
  });

  it("a wrong passphrase can be corrected without starting again", async () => {
    const services = await openApproval(await unlockedDevice());
    await press("Look for a new device");
    await fill("Code on the new device", "042917");
    await fill("This device's passphrase", "not the passphrase");
    await press("Approve this device");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "didn't unlock this device",
    );
    expect(services.pairing.outcome).toBeUndefined();

    const secret = screen.getByLabelText("This device's passphrase");
    await userEvent.clear(secret);
    await userEvent.type(secret, FAKE_DEVICE_PASSPHRASE);
    await press("Approve this device");

    await screen.findByText(/can now open your journal/);
    expect(services.pairing.outcome).toBe("approved");
  });

  it.each([
    ["no code", "", "x", "Type the six digits shown on the new device."],
    [
      "a short code",
      "0429",
      "x",
      "Type the six digits shown on the new device.",
    ],
    ["no passphrase", "042917", "", "Enter this device's passphrase."],
  ])(
    "asks for what is missing with %s",
    async (_name, code, secret, message) => {
      const services = await openApproval(await unlockedDevice());
      await press("Look for a new device");
      if (code !== "") {
        await fill("Code on the new device", code);
      }
      if (secret !== "") {
        await fill("This device's passphrase", secret);
      }

      await press("Approve this device");

      expect(await screen.findByText(message)).toBeTruthy();
      expect(services.pairing.outcome).toBeUndefined();
    },
  );

  it("asks for the recovery key by name when that is what is missing", async () => {
    await openApproval(await unlockedDevice(false));
    await press("Look for a new device");
    await fill("Code on the new device", "042917");

    await press("Approve this device");

    expect(await screen.findByText("Enter your recovery key.")).toBeTruthy();
  });

  it("can refuse the device", async () => {
    const services = await openApproval(await unlockedDevice());
    await press("Look for a new device");

    await press("Don't approve");

    expect(await screen.findByText(/Nothing was shared with it/)).toBeTruthy();
    expect(services.pairing.outcome).toBe("rejected");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a failure to look for a device", async () => {
    const services = await openApproval(await unlockedDevice());
    services.pairing.failNextTakeUpWith = new ApiError("offline");

    await press("Look for a new device");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Check your connection",
    );
  });

  it.each(["signed_out", "signed_in_locked"] as const)(
    "is not shown while %s",
    async (state) => {
      await renderApp("/settings/devices/approve", testServices(state));

      expect(heading().textContent).not.toBe("Approve a new device");
    },
  );
});
