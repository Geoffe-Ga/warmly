/**
 * Device identities and Manage Devices in the browser (PRD DEV-002, DEV-003).
 *
 * These run the real key generation, registration proof and name encryption.
 * Only the transport is a double: the `e2e` build keeps the "server's" device
 * register in `localStorage`, which every tab shares, and each device's own
 * identity in an IndexedDB database of its own. A second tab is therefore a
 * second device on the same account.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import {
  declineDeviceTrust,
  onboard,
  openInApp,
  signIn,
  unlockThisDevice,
} from "./account";

const SERVER_DEVICES = "warmly.fake.server.devices";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function openDevices(page: Page): Promise<void> {
  await openInApp(page, "/settings/devices");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Manage Devices",
  );
}

/** The device cards: every labelled group with an "Added" date. */
function deviceCards(page: Page) {
  return page.locator("section.card").filter({ hasText: "Added" });
}

async function rename(page: Page, from: RegExp, to: string): Promise<void> {
  await page.getByRole("button", { name: from }).click();
  await page.getByLabel("Device name").fill(to);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("The device has its new name.")).toBeVisible();
}

test.describe("Manage Devices", () => {
  test("the first device registers itself during onboarding and is marked as this device", async ({
    page,
  }) => {
    await onboard(page);

    await openDevices(page);

    await expect(deviceCards(page)).toHaveCount(1);
    const card = deviceCards(page).first();
    await expect(
      card.getByRole("heading", { level: 2, name: /^Device added / }),
    ).toBeVisible();
    await expect(card.getByText("This device.")).toBeVisible();
    await expect(card.getByText("Not yet")).toBeVisible();
    await expectNoViolations(page);
  });

  test("a device can be renamed, and the server only ever holds the encrypted name", async ({
    page,
  }) => {
    await onboard(page);
    await openDevices(page);

    await rename(page, /^Rename Device added /, "Kitchen laptop");

    await expect(
      page.getByRole("heading", { level: 2, name: "Kitchen laptop" }),
    ).toBeVisible();
    await expectNoViolations(page);
    const held = await page.evaluate(
      (key) => localStorage.getItem(key) ?? "",
      SERVER_DEVICES,
    );
    expect(held).not.toBe("");
    expect(held).not.toContain("Kitchen");
    expect(held).not.toContain("Device added");
  });

  test("the rename form explains an empty name and can be cancelled", async ({
    page,
  }) => {
    await onboard(page);
    await openDevices(page);
    await page.getByRole("button", { name: /^Rename Device added / }).click();

    await page.getByLabel("Device name").fill("   ");
    await page.getByRole("button", { name: "Save name" }).click();

    await expect(page.getByLabel("Device name")).toBeFocused();
    await expect(
      page.getByText("Type a name of 1 to 60 characters."),
    ).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Device name")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: /^Device added / }),
    ).toBeVisible();
  });

  test("a second device joins with the recovery key; each sees both and marks itself", async ({
    page,
    context,
  }) => {
    const recoveryKey = await onboard(page);
    await openDevices(page);
    await rename(page, /^Rename Device added /, "Kitchen laptop");

    const second = await context.newPage();
    await signIn(second);
    await second.getByLabel("Recovery key").fill(recoveryKey);
    await second.getByRole("button", { name: "Unlock" }).click();
    await declineDeviceTrust(second);
    await openDevices(second);

    await expect(deviceCards(second)).toHaveCount(2);
    const firstSeenBySecond = deviceCards(second).filter({
      hasText: "Kitchen laptop",
    });
    const secondSeenBySecond = deviceCards(second).filter({
      hasText: "Device added",
    });
    await expect(firstSeenBySecond.getByText("This device.")).toHaveCount(0);
    await expect(secondSeenBySecond.getByText("This device.")).toBeVisible();

    // The second device names the pair; the first sees the new names.
    await rename(second, /^Rename Device added /, "Phone");
    await openInApp(page, "/settings");
    await openDevices(page);

    await expect(deviceCards(page)).toHaveCount(2);
    await expect(
      deviceCards(page)
        .filter({ hasText: "Kitchen laptop" })
        .getByText("This device."),
    ).toBeVisible();
    await expect(
      deviceCards(page).filter({ hasText: "Phone" }).getByText("This device."),
    ).toHaveCount(0);
  });

  test("a device keeps its identity across a lock and a reload", async ({
    page,
  }) => {
    await onboard(page);
    await openDevices(page);
    await rename(page, /^Rename Device added /, "Kitchen laptop");

    await page.reload();
    await unlockThisDevice(page);
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await openDevices(page);

    await expect(deviceCards(page)).toHaveCount(1);
    await expect(
      deviceCards(page).first().getByText("This device."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Kitchen laptop" }),
    ).toBeVisible();
  });

  test("the device list is not shown while locked", async ({ page }) => {
    await onboard(page);

    await page.goto("/settings/devices");

    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      "Manage Devices",
    );
    await expect(deviceCards(page)).toHaveCount(0);
  });
});
