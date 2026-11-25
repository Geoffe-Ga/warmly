/**
 * Approving a new device from an unlocked one (PRD DEV-001 path A; AC-19).
 *
 * These run the real pairing: the commitment, the code both devices derive,
 * and the HPKE transfer of the account key. Only the relay is a double: the
 * `e2e` build keeps the "server's" pairing requests in `localStorage`, which
 * every tab shares, while each tab has its own device keys. A second tab is
 * therefore a second device of the same account.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "../fixtures/test";

import {
  DEVICE_PASSPHRASE,
  declineDeviceTrust,
  keyFingerprint,
  onboard,
  openInApp,
  signIn,
} from "./account";

const SERVER_PAIRING = "warmly.fake.server.pairing";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** On a new device: sign in and ask to be approved. */
async function askToBeApproved(page: Page): Promise<void> {
  await signIn(page);
  await page
    .getByRole("link", { name: "Approve from another device instead" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Approve from another device",
  );
  await page.getByRole("button", { name: /Show a code|Start again/ }).click();
  await expect(page.getByText("Waiting for your other device")).toBeVisible();
}

/** On the unlocked device: find the waiting request. */
async function lookForDevice(page: Page): Promise<void> {
  await openInApp(page, "/settings/devices/approve");
  await page.getByRole("button", { name: "Look for a new device" }).click();
  await expect(page.getByLabel("Code on the new device")).toBeVisible();
}

async function shownCode(page: Page): Promise<string> {
  return (await page.getByTestId("pairing-code").innerText()).trim();
}

test.describe("approving a new device", () => {
  test("the new device shows a code, the first approves it, and the new one opens the journal", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const fingerprint = await keyFingerprint(page);
    // Something encrypted on the first device, for the second to read.
    await openInApp(page, "/settings/devices");
    await page.getByRole("button", { name: /^Rename Device added / }).click();
    await page.getByLabel("Device name").fill("Kitchen laptop");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("The device has its new name.")).toBeVisible();

    const second = await context.newPage();
    await askToBeApproved(second);
    await expectNoViolations(second);

    await lookForDevice(page);
    await expectNoViolations(page);
    const code = await shownCode(second);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    await expectNoViolations(second);

    await page.getByLabel("Code on the new device").fill(code);
    await page.getByLabel("This device's passphrase").fill(DEVICE_PASSPHRASE);
    await page.getByRole("button", { name: "Approve this device" }).click();
    await expect(
      page.getByText("The new device can now open your journal."),
    ).toBeVisible();
    await expectNoViolations(page);

    // The new device unlocks by itself and is offered a passphrase.
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "Unlock this device more easily",
    );
    await declineDeviceTrust(second);
    await expect(
      second.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    expect(await keyFingerprint(second)).toBe(fingerprint);

    // It reads the name the first device encrypted, and is registered too.
    await openInApp(second, "/settings/devices");
    await expect(
      second.getByRole("heading", { level: 2, name: "Kitchen laptop" }),
    ).toBeVisible();
    await expect(
      second.locator("section.card").filter({ hasText: "Added" }),
    ).toHaveCount(2);

    // The "server" held the key only as ciphertext, and never the code.
    const held = await page.evaluate(
      (key) => localStorage.getItem(key) ?? "",
      SERVER_PAIRING,
    );
    expect(held).toContain("wrappedKey");
    expect(held).not.toContain(code.replace(" ", ""));
    expect(held).not.toContain(fingerprint);
  });

  test("a wrong code cancels the request on both devices and shares nothing", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const second = await context.newPage();
    await askToBeApproved(second);
    await lookForDevice(page);
    const code = (await shownCode(second)).replace(" ", "");
    const wrong = code === "000000" ? "000001" : "000000";

    await page.getByLabel("Code on the new device").fill(wrong);
    await page.getByLabel("This device's passphrase").fill(DEVICE_PASSPHRASE);
    await page.getByRole("button", { name: "Approve this device" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "isn't the code on the new device",
    );
    await expectNoViolations(page);
    await expect(second.getByRole("alert")).toContainText(
      "didn't approve this request",
    );
    await expectNoViolations(second);
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "Approve from another device",
    );
    const held = await page.evaluate(
      (key) => localStorage.getItem(key) ?? "",
      SERVER_PAIRING,
    );
    expect(held).not.toContain("wrappedKey");

    // The new device can ask again, and a correct code then works.
    await second.getByRole("button", { name: "Start again" }).click();
    await expect(
      second.getByText("Waiting for your other device"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Look again" }).click();
    await page
      .getByLabel("Code on the new device")
      .fill(await shownCode(second));
    await page.getByLabel("This device's passphrase").fill(DEVICE_PASSPHRASE);
    await page.getByRole("button", { name: "Approve this device" }).click();
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "Unlock this device more easily",
    );
  });

  test("a wrong passphrase releases nothing and can be corrected", async ({
    page,
    context,
  }) => {
    await onboard(page);
    const second = await context.newPage();
    await askToBeApproved(second);
    await lookForDevice(page);

    await page
      .getByLabel("Code on the new device")
      .fill(await shownCode(second));
    await page
      .getByLabel("This device's passphrase")
      .fill("not the passphrase");
    await page.getByRole("button", { name: "Approve this device" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "didn't unlock this device",
    );
    await expect(second.getByTestId("pairing-code")).toBeVisible();

    await page.getByLabel("This device's passphrase").fill(DEVICE_PASSPHRASE);
    await page.getByRole("button", { name: "Approve this device" }).click();

    await expect(second.getByRole("heading", { level: 1 })).toHaveText(
      "Unlock this device more easily",
    );
  });

  test("the first device can refuse, and says when no device is waiting", async ({
    page,
    context,
  }) => {
    await onboard(page);
    await openInApp(page, "/settings/devices/approve");
    await page.getByRole("button", { name: "Look for a new device" }).click();
    await expect(page.getByText("No device is waiting")).toBeVisible();
    await expectNoViolations(page);

    const second = await context.newPage();
    await askToBeApproved(second);
    await page.getByRole("button", { name: "Look again" }).click();
    await page.getByRole("button", { name: "Don't approve" }).click();

    await expect(page.getByText("Nothing was shared with it.")).toBeVisible();
    await expect(second.getByRole("alert")).toContainText(
      "didn't approve this request",
    );
  });

  test("neither screen is shown in the wrong state", async ({ page }) => {
    await page.goto("/recover/another-device");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");

    await onboard(page);
    await openInApp(page, "/recover/another-device");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      "Approve from another device",
    );

    await page.goto("/settings/devices/approve");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      "Approve a new device",
    );
  });
});
