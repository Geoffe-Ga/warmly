/**
 * The accessibility sweep: every route, and every kind of state a screen
 * can be in, checked by machine (PRD UI-001 to UI-008; AC-23).
 *
 * The list of routes comes from the app's own route table, and the kinds
 * of state from the list below. A route with no entry in the sweep, or a
 * kind of state that no entry shows, fails the suite: a new screen cannot
 * be added without being swept.
 *
 * Each entry is checked four ways: axe against WCAG 2.2 AA, no sideways
 * scrolling at 320 CSS pixels, no sideways scrolling at double text size,
 * and a visible focus ring on whatever the Tab key reaches first.
 *
 * This is what a machine can check. It is not a screen-reader test and
 * not a certification: see `docs/accessibility.md`.
 */
import AxeBuilder from "@axe-core/playwright";

import { ROUTES, pathFor, type RouteId } from "../../src/app/routes";
import { expect, test, type Page } from "../fixtures/test";

import { onboard, openInApp, openMenu, unlockThisDevice } from "./account";
import { parkStoredVersion } from "./conflict";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SAMPLE_PARAMS = { id: "sample-1", cardId: "sample-2" };
const PROMPTS = [
  "What's going well?",
  "What would you like to improve?",
  "Since your last journal entry, how has your partner helped you feel loved?",
];

/** The kinds of state every app has, each of which must be swept. */
const STATE_KINDS = [
  "empty",
  "content",
  "loading",
  "error",
  "dialog",
  "menu",
  "locked",
  "conflict",
  "offline",
] as const;
type StateKind = (typeof STATE_KINDS)[number];

/** One screen in one state. */
interface Swept {
  readonly route: RouteId;
  readonly kind: StateKind;
  /** What is on screen, for the report. */
  readonly name: string;
}

/**
 * Wait until the page has stopped changing, so what is measured is what
 * the screen settles into and not a moment on the way.
 */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const QUIET_MS = 300;
        const LIMIT_MS = 5000;
        let quiet = window.setTimeout(done, QUIET_MS);
        const limit = window.setTimeout(done, LIMIT_MS);
        const observer = new MutationObserver(() => {
          window.clearTimeout(quiet);
          quiet = window.setTimeout(done, QUIET_MS);
        });
        function done(): void {
          window.clearTimeout(quiet);
          window.clearTimeout(limit);
          observer.disconnect();
          resolve();
        }
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }),
  );
}

/** How far the page scrolls sideways, in CSS pixels. */
function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

/**
 * Check the screen as it is now.
 *
 * @param page - The page.
 * @param swept - Which screen and state this is, for the report.
 * @param options - `still` skips waiting for the page to stop changing,
 *   for a state that is itself a moment (loading).
 */
async function check(
  page: Page,
  swept: Swept,
  options: { readonly still?: boolean } = {},
): Promise<void> {
  const label = `${swept.route} [${swept.kind}: ${swept.name}]`;
  if (options.still !== true) {
    await settled(page);
  }

  // 1. axe, WCAG 2.2 AA. No rule is turned off.
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations, `axe: ${label}`).toEqual([]);

  // 2. Reflow: nothing scrolls sideways at 320 CSS pixels wide.
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 320, height: viewport.height });
  expect(await overflow(page), `320px wide: ${label}`).toBeLessThanOrEqual(1);
  await page.setViewportSize(viewport);

  // 3. Text at double size, in a font far wider than any real one, so
  // the answer does not depend on the machine's fonts.
  const zoomed = await page.evaluate(() => {
    const root = document.documentElement;
    root.style.fontSize = "200%";
    root.style.letterSpacing = "0.3em";
    const extra = root.scrollWidth - root.clientWidth;
    root.style.fontSize = "";
    root.style.letterSpacing = "";
    return extra;
  });
  expect(zoomed, `200% text: ${label}`).toBeLessThanOrEqual(1);

  // 4. Whatever takes keyboard focus shows a focus ring.
  const ring = await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>(
      "main a[href], main button, main input, main textarea, [role=alertdialog] button",
    );
    if (first === null) {
      return "nothing to focus";
    }
    first.focus({ focusVisible: true } as FocusOptions);
    const style = getComputedStyle(first);
    const shown =
      style.outlineStyle !== "none" &&
      Number.parseFloat(style.outlineWidth) >= 2;
    first.blur();
    return shown ? "shown" : `no ring on <${first.tagName.toLowerCase()}>`;
  });
  expect(["shown", "nothing to focus"], `focus ring: ${label}`).toContain(ring);
}

async function writeEntry(page: Page, good: string): Promise<void> {
  await openInApp(page, "/journal/new");
  await page.getByLabel(PROMPTS[0] ?? "").fill(good);
  await page.getByLabel(PROMPTS[1] ?? "").fill("Synthetic second answer.");
  await page.getByLabel(PROMPTS[2] ?? "").fill("Synthetic third answer.");
  await page.getByRole("button", { name: "Save entry" }).click();
  await expect(page.getByText("A journal entry.")).toBeVisible();
}

async function collectionWithCards(page: Page): Promise<void> {
  await openInApp(page, "/prepare");
  await page.getByLabel("Name").fill("Sunday talk");
  await page.getByRole("button", { name: "Create collection" }).click();
  await page.getByRole("link", { name: /Sunday talk/ }).click();
  for (const text of ["Thank you for Thursday.", "What would help you?"]) {
    await page.getByLabel("What do you want to say?").fill(text);
    await page.getByRole("button", { name: "Add card" }).click();
    await expect(page.getByLabel("What do you want to say?")).toHaveValue("");
  }
}

/** Every screen and state the tests below show, written down as they go. */
const SWEPT: Swept[] = [];

function sweeping(route: RouteId, kind: StateKind, name: string): Swept {
  return { route, kind, name };
}

/**
 * The plan: what each test below sweeps. It is written out, and not
 * gathered while the tests run, so that the completeness check does not
 * depend on which tests ran first or in which worker.
 */
const PLAN: readonly Swept[] = [
  ...ROUTES.filter(
    (route) => route.access === "public" || route.access === "open",
  ).map((route) => sweeping(route.id, "empty", "signed out")),
  ...ROUTES.filter((route) => route.access === "locked").map((route) =>
    sweeping(route.id, "locked", "signed in, locked"),
  ),
  ...ROUTES.filter((route) => route.access === "private").map((route) =>
    sweeping(route.id, "empty", "unlocked, nothing written"),
  ),
  sweeping("help", "locked", "signed in, locked"),
  sweeping("help", "error", "a browser that cannot add a device"),
  sweeping("home", "menu", "the menu, open"),
  sweeping("settings", "menu", "the menu, open, on its own page"),
  sweeping("home", "offline", "unlocked, no connection"),
  sweeping("locked", "offline", "locked, no connection"),
  sweeping("journal", "content", "an entry and a note"),
  sweeping("journal", "empty", "a search that finds nothing"),
  sweeping("journal", "loading", "entries still being read"),
  sweeping("journal-new", "error", "the device has no room"),
  sweeping("journal-entry", "content", "an entry"),
  sweeping("journal-entry", "dialog", "delete confirmation"),
  sweeping("journal-edit", "content", "an entry being edited"),
  sweeping("journal-edit", "content", "unsaved changes brought back"),
  sweeping("after-conversation", "content", "a saved note"),
  sweeping("reflect-session", "dialog", "what will be sent"),
  sweeping("reflect-session", "content", "a cited answer"),
  sweeping("reflect", "content", "a saved reflection"),
  sweeping("prepare", "content", "a collection"),
  sweeping("collection", "content", "two cards"),
  sweeping("card", "content", "a card of the person's own"),
  sweeping("present", "content", "a card, large"),
  sweeping("print", "content", "cards to print"),
  sweeping("suggest-cards", "content", "entries to tick"),
  sweeping("suggest-cards", "dialog", "what will be sent"),
  sweeping("card", "content", "an AI card, learning panel open"),
  sweeping("card", "content", "suggested wordings"),
  sweeping("sync-conflicts", "conflict", "an entry changed in two places"),
  sweeping("journal-entry", "conflict", "an entry with two versions"),
];

/** Check a screen, and note that the plan's entry for it was carried out. */
async function sweep(
  page: Page,
  route: RouteId,
  kind: StateKind,
  name: string,
  options: { readonly still?: boolean } = {},
): Promise<void> {
  const swept = sweeping(route, kind, name);
  // A test may only sweep what the plan lists, so the plan stays true.
  expect(
    PLAN.some(
      (each) =>
        each.route === route && each.kind === kind && each.name === name,
    ),
    `not in the plan: ${route} [${kind}: ${name}]`,
  ).toBe(true);
  SWEPT.push(swept);
  await test.step(`${route} [${kind}: ${name}]`, async () => {
    await check(page, swept, options);
  });
}

test.describe("the plan covers the app (AC-23)", () => {
  test("every route in the route table is swept", () => {
    const planned = new Set(PLAN.map((each) => each.route));
    const missing = ROUTES.map((route) => route.id).filter(
      (id) => !planned.has(id),
    );
    expect(missing).toEqual([]);
  });

  test("every kind of state is swept somewhere", () => {
    const planned = new Set(PLAN.map((each) => each.kind));
    const missing = STATE_KINDS.filter((kind) => !planned.has(kind));
    expect(missing).toEqual([]);
  });

  test("no entry is planned twice", () => {
    const keys = PLAN.map((each) => `${each.route}|${each.kind}|${each.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

test.describe("the sweep (UI-001 to UI-008, AC-23)", () => {
  // Many screens in one go, each a real save or a real navigation.
  test.slow();

  test("screens that need no sign-in, signed out", async ({ page }) => {
    for (const route of ROUTES.filter(
      (each) => each.access === "public" || each.access === "open",
    )) {
      await page.goto(pathFor(route.id, SAMPLE_PARAMS));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await sweep(page, route.id, "empty", "signed out");
    }
  });

  test("screens for a signed-in person whose journal is locked", async ({
    page,
  }) => {
    await onboard(page);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    for (const route of ROUTES.filter((each) => each.access === "locked")) {
      await openInApp(page, pathFor(route.id, SAMPLE_PARAMS));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await sweep(page, route.id, "locked", "signed in, locked");
    }
    // The page of fixed words can be read while locked too.
    await openInApp(page, pathFor("help"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await sweep(page, "help", "locked", "signed in, locked");
  });

  test("the notice in a browser that cannot add a device", async ({ page }) => {
    // The browser refuses the one algorithm the app needs to add a device
    // (ADR-0005). Everything else it offers is left alone.
    await page.addInitScript(() => {
      const generateKey = crypto.subtle.generateKey.bind(crypto.subtle);
      crypto.subtle.generateKey = ((...args: unknown[]) => {
        const algorithm = args[0] as { name?: string } | string;
        const name = typeof algorithm === "string" ? algorithm : algorithm.name;
        return name === "Ed25519"
          ? Promise.reject(new DOMException("no", "NotSupportedError"))
          : (generateKey as (...all: unknown[]) => Promise<unknown>)(...args);
      }) as typeof crypto.subtle.generateKey;
    });
    await page.goto(pathFor("help"));

    await expect(page.getByRole("alert")).toContainText(
      "cannot make the signature Warmly uses to add a device",
    );
    await sweep(page, "help", "error", "a browser that cannot add a device");
  });

  test("every private screen, unlocked, before anything is written", async ({
    page,
  }) => {
    await onboard(page);
    for (const route of ROUTES.filter((each) => each.access === "private")) {
      await openInApp(page, pathFor(route.id, SAMPLE_PARAMS));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await sweep(page, route.id, "empty", "unlocked, nothing written");
    }
  });

  test("the menu, open", async ({ page }) => {
    await onboard(page);
    await openMenu(page);
    await expect(
      page.getByRole("navigation", { name: "Secondary" }),
    ).toBeVisible();
    await sweep(page, "home", "menu", "the menu, open");
    // The sweep ends by moving keyboard focus into the page, and focus
    // leaving the menu closes it.
    await expect(
      page.getByRole("navigation", { name: "Secondary" }),
    ).toHaveCount(0);

    // On one of its own pages, where a link in it is marked as current.
    await openMenu(page);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Settings",
    );
    await openMenu(page);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await sweep(page, "settings", "menu", "the menu, open, on its own page");

    // It closes on Escape, and the focus goes back to its button.
    await openMenu(page);
    await expect(
      page.getByRole("navigation", { name: "Secondary" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("navigation", { name: "Secondary" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
  });

  test("with no connection, unlocked and locked", async ({ page, context }) => {
    await onboard(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await expect(page.locator(".offline-notice")).toContainText("Offline:");
    await sweep(page, "home", "offline", "unlocked, no connection");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Warmly is locked",
    );
    await expect(page.locator(".offline-notice")).toContainText("Offline:");
    await sweep(page, "locked", "offline", "locked, no connection");
    await unlockThisDevice(page);
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  });

  test("the journal with writing in it, a search that finds nothing, and its dialogs", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "We cooked dinner together on Sunday.");
    await sweep(page, "journal-entry", "content", "an entry");

    await page.getByRole("button", { name: "Delete this entry" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await sweep(page, "journal-entry", "dialog", "delete confirmation");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Keep this entry" })
      .click();

    await page.getByRole("link", { name: "Edit this entry" }).click();
    await expect(page.getByLabel(PROMPTS[0] ?? "")).toHaveValue(
      "We cooked dinner together on Sunday.",
    );
    await sweep(page, "journal-edit", "content", "an entry being edited");

    // Leaving without saving or cancelling keeps what was typed, and the
    // edit screen offers it back.
    const editPath = new URL(page.url()).pathname;
    await page.getByLabel(PROMPTS[0] ?? "").fill("We cooked on Sunday.");
    await openInApp(page, "/journal");
    await openInApp(page, editPath);
    await expect(page.getByText("Unsaved changes brought back")).toBeVisible();
    await sweep(
      page,
      "journal-edit",
      "content",
      "unsaved changes brought back",
    );
    await page
      .getByRole("button", { name: "Start again from the saved entry" })
      .click();
    await expect(page.getByLabel(PROMPTS[0] ?? "")).toHaveValue(
      "We cooked dinner together on Sunday.",
    );

    await openInApp(page, pathFor("after-conversation", { id: "new" }));
    await page.getByLabel("What went well?").fill("We both stayed calm.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save changes" }),
    ).toBeVisible();
    await sweep(page, "after-conversation", "content", "a saved note");

    await openInApp(page, "/journal");
    await expect(
      page.getByRole("navigation", { name: "Entries" }).getByRole("link"),
    ).toHaveCount(2);
    await sweep(page, "journal", "content", "an entry and a note");

    await page.getByLabel("Search your journal").fill("no such words");
    await expect(
      page.getByRole("navigation", { name: "Entries" }).getByRole("link"),
    ).toHaveCount(0);
    await sweep(page, "journal", "empty", "a search that finds nothing");
  });

  test("the journal while its entries are still being read", async ({
    page,
  }) => {
    // Reading records is held back, so the loading state stays on show.
    // The hold is armed while the app is locked, because the app starts
    // reading records the moment it unlocks: arming it afterwards would be
    // a race. Unlocking with a passphrase decrypts twice (the two layers
    // round the root key), so those two go through and every later one,
    // which can only be a record, waits. Nothing else is changed.
    await page.addInitScript(() => {
      const hold = window as unknown as { warmlyTestLetThrough?: number };
      const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      crypto.subtle.decrypt = async (...args: Parameters<typeof decrypt>) => {
        if (hold.warmlyTestLetThrough !== undefined) {
          if (hold.warmlyTestLetThrough === 0) {
            await new Promise(() => undefined);
          }
          hold.warmlyTestLetThrough -= 1;
        }
        return decrypt(...args);
      };
    });
    await onboard(page);
    await writeEntry(page, "We cooked dinner together on Sunday.");
    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page.getByLabel("Device passphrase")).toBeVisible();
    await page.evaluate(() => {
      (
        window as unknown as { warmlyTestLetThrough: number }
      ).warmlyTestLetThrough = 2;
    });
    await unlockThisDevice(page);
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await openInApp(page, "/journal");

    await expect(page.getByText(/Getting your entries\./)).toBeVisible();
    await sweep(page, "journal", "loading", "entries still being read", {
      still: true,
    });
  });

  test("a save that fails because the device has no room", async ({ page }) => {
    await page.addInitScript(() => {
      const flag = window as unknown as { warmlyTestFull?: boolean };
      const aborted = new WeakSet<IDBTransaction>();
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function refusing(
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        const request = put.apply(this, args);
        if (flag.warmlyTestFull === true && !aborted.has(this.transaction)) {
          aborted.add(this.transaction);
          const transaction = this.transaction;
          Object.defineProperty(transaction, "error", {
            configurable: true,
            get: () => new DOMException("No room.", "QuotaExceededError"),
          });
          queueMicrotask(() => {
            transaction.abort();
          });
        }
        return request;
      };
    });
    await onboard(page);
    await openInApp(page, "/journal/new");
    await page.evaluate(() => {
      (window as unknown as { warmlyTestFull: boolean }).warmlyTestFull = true;
    });
    for (const prompt of PROMPTS) {
      await page.getByLabel(prompt).fill("Synthetic answer.");
    }
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(
      page.getByText("because the device has no room left").first(),
    ).toBeVisible();
    await sweep(page, "journal-new", "error", "the device has no room");
  });

  test("Reflect: the dialog, a cited answer and the saved reflection", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "We cooked dinner together on Sunday.");
    await openInApp(page, pathFor("reflect-session", { id: "new" }));
    await page
      .getByLabel("What would you like to ask about your journal?")
      .fill("What has gone well lately?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await sweep(page, "reflect-session", "dialog", "what will be sent");

    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Send to Test provider" })
      .click();
    await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible();
    await sweep(page, "reflect-session", "content", "a cited answer");

    await openInApp(page, "/reflect");
    await expect(page.getByText("What has gone well lately?")).toBeVisible();
    await sweep(page, "reflect", "content", "a saved reflection");
  });

  test("cards: a collection, a card, presenting and printing", async ({
    page,
  }) => {
    await onboard(page);
    await collectionWithCards(page);
    await sweep(page, "collection", "content", "two cards");

    await page
      .getByRole("navigation", { name: "Cards in this collection" })
      .getByRole("link")
      .first()
      .click();
    await expect(page.getByText("Written by you.")).toBeVisible();
    await sweep(page, "card", "content", "a card of the person's own");
    await page.getByRole("link", { name: "Back to the collection" }).click();

    await page.getByRole("link", { name: "Present these cards" }).click();
    await expect(page.getByText("Card 1 of 2")).toBeVisible();
    await sweep(page, "present", "content", "a card, large");
    await page
      .getByRole("link", { name: "Close and go back to the collection" })
      .click();

    await page.getByRole("link", { name: "Print these cards" }).click();
    await expect(
      page.getByRole("region", { name: "What will be printed" }),
    ).toBeVisible();
    await sweep(page, "print", "content", "cards to print");

    await openInApp(page, "/prepare");
    await expect(page.getByRole("link", { name: /Sunday talk/ })).toBeVisible();
    await sweep(page, "prepare", "content", "a collection");
  });

  test("cards drafted by AI: the picker, its dialog, learning mode and suggestions", async ({
    page,
  }) => {
    await onboard(page);
    await writeEntry(page, "We cooked dinner together on Sunday.");
    await collectionWithCards(page);
    await page
      .getByRole("link", { name: "Pick entries and suggest cards" })
      .click();
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await sweep(page, "suggest-cards", "content", "entries to tick");

    await page.getByRole("checkbox", { name: /cooked dinner/ }).check();
    await page.getByRole("button", { name: "Suggest cards" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await sweep(page, "suggest-cards", "dialog", "what will be sent");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Send to Test provider" })
      .click();
    await expect(page.getByText("1 card was drafted")).toBeVisible();

    await page.getByRole("link", { name: "Back to the collection" }).click();
    await page
      .getByRole("navigation", { name: "Cards in this collection" })
      .getByRole("link")
      .last()
      .click();
    await page.getByRole("radio", { name: /^Learning/ }).check();
    await page.getByRole("button", { name: /^Appreciation/ }).click();
    const panel = page.getByRole("region", { name: "About this part" });
    await expect(panel).toBeVisible();
    await sweep(page, "card", "content", "an AI card, learning panel open");

    await panel.getByRole("button", { name: "Generate more options" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Send to Test provider" })
      .click();
    await expect(
      panel.getByRole("region", { name: "Other ways to say this part" }),
    ).toBeVisible();
    await sweep(page, "card", "content", "suggested wordings");
  });

  test("an entry changed in two places, on its own screen and on the review screen", async ({
    page,
    context,
  }) => {
    await onboard(page);
    await writeEntry(page, "Synthetic first version");
    await expect(page.locator(".sync-status [role=status]")).toHaveText(
      "All changes saved",
    );
    await parkStoredVersion(page);
    await context.setOffline(true);
    await page.getByRole("link", { name: "Edit this entry" }).click();
    await page.getByLabel(PROMPTS[0] ?? "").fill("Synthetic second version");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("link", { name: "Review the two versions" }),
    ).toBeVisible();
    await sweep(
      page,
      "journal-entry",
      "conflict",
      "an entry with two versions",
    );

    await page.getByRole("link", { name: "Review the two versions" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Changed in two places",
    );
    await expect(
      page.getByRole("button", { name: "Keep the other version" }),
    ).toBeVisible();
    await sweep(
      page,
      "sync-conflicts",
      "conflict",
      "an entry changed in two places",
    );
  });
});

test.describe("motion (UI-003)", () => {
  test("nothing animates for a person who has asked for less motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await onboard(page);
    await openInApp(page, "/journal/new");
    await expect(page.getByLabel(PROMPTS[0] ?? "")).toBeVisible();

    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const seconds = (value: string): number =>
            Math.max(
              ...value.split(",").map((part) => Number.parseFloat(part)),
            );
          return (
            (style.animationName !== "none" &&
              seconds(style.animationDuration) > 0) ||
            seconds(style.transitionDuration) > 0
          );
        })
        .map((element) => element.tagName.toLowerCase()),
    );
    expect(moving).toEqual([]);
  });
});
