import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "../fixtures/test";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const GALLERY = "/dev/components";

/**
 * Open the gallery and wait until the app has finished starting, so a test
 * never measures the brief "Opening Warmly" screen instead.
 */
async function openGallery(page: Page): Promise<void> {
  await page.goto(GALLERY);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Component gallery",
  );
}

test.describe("component kit (UI-001..008, AC-23)", () => {
  test("has no detectable WCAG 2.2 AA violations", async ({ page }) => {
    await openGallery(page);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("has no violations with the confirm dialog open", async ({ page }) => {
    await openGallery(page);
    await page.getByRole("button", { name: "Delete sample" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("the dialog traps focus, closes on Escape and restores focus", async ({
    page,
  }) => {
    await openGallery(page);
    const opener = page.getByRole("button", { name: "Delete sample" });
    await opener.click();
    const dialog = page.getByRole("alertdialog");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Delete sample" });

    await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.getByText("You cancelled.")).toBeVisible();
  });

  test("every control meets the 44 by 44 pixel touch target", async ({
    page,
  }) => {
    await openGallery(page);

    // A checkbox is tapped through the label that wraps it, so the label is
    // the target that is measured.
    const controls = page.locator(
      "main button, main input:not([type=checkbox]), main textarea, main label:has(input[type=checkbox])",
    );
    await expect(
      page.locator("main input[type=checkbox]:not(label input)"),
    ).toHaveCount(0);
    expect(
      await page.locator("main label:has(input[type=checkbox])").count(),
    ).toBeGreaterThan(0);
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const box = await controls.nth(index).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("content reflows at 320 pixels wide without horizontal scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openGallery(page);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("honours a reduced-motion preference", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openGallery(page);

    const duration = await page
      .getByRole("button", { name: "Primary" })
      .evaluate((element) => getComputedStyle(element).transitionDuration);

    expect(duration).toBe("0s");
  });
});
