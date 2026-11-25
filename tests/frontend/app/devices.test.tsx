import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../../../src/api/client";
import {
  FAKE_DEVICES,
  FakeDeviceDirectory,
} from "../../../src/testing/fake-device-directory";
import { DeviceError } from "../../../src/devices/this-device";

import { heading, renderApp, testServices, type TestServices } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

async function open(
  services: TestServices = testServices("unlocked"),
): Promise<TestServices> {
  await renderApp("/settings/devices", services);
  return services;
}

/** The card for a device, found by its heading. */
async function card(name: string): Promise<HTMLElement> {
  const title = await screen.findByRole("heading", { level: 2, name });
  return title.closest("section") as HTMLElement;
}

describe("Manage Devices (DEV-002, DEV-003)", () => {
  it("lists each device with its name, the date it was added and its last sync", async () => {
    await open();

    const laptop = await card("Kitchen laptop");
    const added = new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
    }).format(FAKE_DEVICES[0]?.createdAt);

    expect(heading().textContent).toBe("Manage Devices");
    expect(within(laptop).getByText("Added").tagName).toBe("DT");
    expect(within(laptop).getByText(added).tagName).toBe("DD");
    expect(within(laptop).getByText("Last synced").tagName).toBe("DT");
    expect(within(laptop).getByText("Not yet").tagName).toBe("DD");
  });

  it("marks the device in use, and only that one", async () => {
    await open();

    const laptop = await card("Kitchen laptop");
    const other = await card("Unnamed device");

    expect(within(laptop).getByText("This device.")).toBeTruthy();
    expect(within(other).queryByText("This device.")).toBeNull();
  });

  it("shows a device whose name cannot be read as unnamed, never as ciphertext", async () => {
    await open();

    expect(await card("Unnamed device")).toBeTruthy();
  });

  it("shows the date of the last sync when there has been one", async () => {
    const services = testServices("unlocked");
    const synced = new Date("2026-11-21T07:00:00Z");
    await open({
      ...services,
      devices: new FakeDeviceDirectory([
        {
          ...(FAKE_DEVICES[0] as (typeof FAKE_DEVICES)[0]),
          lastSyncAt: synced,
        },
      ]),
    });

    const laptop = await card("Kitchen laptop");

    expect(
      within(laptop).getByText(
        new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
          synced,
        ),
      ),
    ).toBeTruthy();
    expect(within(laptop).queryByText("Not yet")).toBeNull();
  });

  it("says it is loading until the list arrives", async () => {
    const services = testServices("unlocked");
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new FakeDeviceDirectory();
    const list = slow.list.bind(slow);
    slow.list = async () => {
      await waiting;
      return list();
    };
    await open({ ...services, devices: slow });

    expect(screen.getByText("Getting your devices.")).toBeTruthy();
    release();

    expect(await card("Kitchen laptop")).toBeTruthy();
    expect(screen.queryByText("Getting your devices.")).toBeNull();
  });

  it("explains a failure to load and loads again on request", async () => {
    const services = testServices("unlocked");
    services.devices.failNextWith = new ApiError("offline");
    await open(services);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your devices");
    expect(alert.textContent).toContain("Check your connection");
    expect(
      screen.queryByRole("heading", { level: 2, name: "Kitchen laptop" }),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await card("Kitchen laptop")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never shows the detail of an unexpected failure", async () => {
    const services = testServices("unlocked");
    services.devices.failNextWith = new Error("SECRET internal detail");
    await open(services);

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Something went wrong");
    expect(document.body.textContent).not.toContain("SECRET");
  });

  it("offers to approve a new device, and says honestly that removing one is not built yet", async () => {
    await open();

    const link = await screen.findByRole("link", {
      name: "Approve a new device",
    });

    expect(link.getAttribute("href")).toBe("/settings/devices/approve");
    expect(
      screen.getByText("Removing a device is not built yet."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /revoke|remove/i })).toBeNull();
  });

  it.each(["signed_out", "signed_in_locked"] as const)(
    "is not shown while %s",
    async (state) => {
      await renderApp("/settings/devices", testServices(state));

      expect(heading().textContent).not.toBe("Manage Devices");
      expect(screen.queryByText("Kitchen laptop")).toBeNull();
    },
  );
});

describe("renaming a device (DEV-003)", () => {
  it("gives each Rename button a name that says which device it is for", async () => {
    await open();
    await card("Kitchen laptop");

    expect(
      screen.getByRole("button", { name: "Rename Kitchen laptop" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rename Unnamed device" }),
    ).toBeTruthy();
  });

  it("saves a new name, confirms it and shows it in the list", async () => {
    const services = await open();
    await card("Kitchen laptop");

    await userEvent.click(
      screen.getByRole("button", { name: "Rename Kitchen laptop" }),
    );
    const field = screen.getByLabelText("Device name");
    expect((field as HTMLInputElement).value).toBe("Kitchen laptop");
    await userEvent.clear(field);
    await userEvent.type(field, "Work laptop");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(await card("Work laptop")).toBeTruthy();
    expect(
      screen.getByText("The device has its new name.").getAttribute("role"),
    ).toBe("status");
    expect((await services.devices.list())[0]?.name).toBe("Work laptop");
    expect(screen.queryByLabelText("Device name")).toBeNull();
  });

  it("starts from an empty box for a device with no readable name", async () => {
    await open();
    await card("Unnamed device");

    await userEvent.click(
      screen.getByRole("button", { name: "Rename Unnamed device" }),
    );

    expect(
      (screen.getByLabelText("Device name") as HTMLInputElement).value,
    ).toBe("");
  });

  it.each([
    ["an empty name", ""],
    ["only spaces", "   "],
    ["a name that is too long", "x".repeat(61)],
  ])("asks for a usable name instead of saving %s", async (_name, typed) => {
    const services = await open();
    await card("Kitchen laptop");
    await userEvent.click(
      screen.getByRole("button", { name: "Rename Kitchen laptop" }),
    );
    const field = screen.getByLabelText("Device name");
    await userEvent.clear(field);
    if (typed !== "") {
      await userEvent.type(field, typed);
    }

    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Type a name of 1 to 60 characters.")).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    expect((await services.devices.list())[0]?.name).toBe("Kitchen laptop");
  });

  it("cancels without changing anything", async () => {
    const services = await open();
    await card("Kitchen laptop");
    await userEvent.click(
      screen.getByRole("button", { name: "Rename Kitchen laptop" }),
    );
    await userEvent.type(screen.getByLabelText("Device name"), " two");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Device name")).toBeNull();
    expect(await card("Kitchen laptop")).toBeTruthy();
    expect(screen.queryByText("The device has its new name.")).toBeNull();
    expect((await services.devices.list())[0]?.name).toBe("Kitchen laptop");
  });

  it("explains a failed save and keeps what was typed", async () => {
    const services = await open();
    await card("Kitchen laptop");
    await userEvent.click(
      screen.getByRole("button", { name: "Rename Kitchen laptop" }),
    );
    const field = screen.getByLabelText("Device name");
    await userEvent.clear(field);
    await userEvent.type(field, "Work laptop");
    services.devices.failNextWith = new DeviceError("not_found");

    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "no longer on your account",
    );
    expect(
      (screen.getByLabelText("Device name") as HTMLInputElement).value,
    ).toBe("Work laptop");
  });
});

describe("the in-memory device directory", () => {
  it("refuses a bad name and an unknown device as the real one does", async () => {
    const directory = new FakeDeviceDirectory();

    await expect(
      directory.rename(FAKE_DEVICES[0]?.id ?? "", " "),
    ).rejects.toMatchObject({ code: "invalid_name" });
    await expect(directory.rename("unknown", "Phone")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
