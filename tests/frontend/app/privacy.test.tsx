/**
 * The page that says what is private and where that ends (PRD SEC-001,
 * OPS-003, §13.9). Its sentences are promises about the product, so the
 * ones that matter most are pinned here word for word.
 */
import { cleanup, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROUTES } from "../../../src/app/routes";
import { DELETE_WARNING } from "../../../src/ui/screens/journal/shared";
import { PRIVACY } from "../../../src/ui/screens/help/privacy";
import { DELETING_STATUS } from "../../../src/ui/screens/settings/StatusSummary";

import { renderApp, testServices, visit } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

function section(heading: string): string {
  const found = PRIVACY.find((each) => each.heading === heading);
  if (found === undefined) {
    throw new Error(`No section headed "${heading}"`);
  }
  return found.text;
}

describe("the privacy page (SEC-001)", () => {
  it.each(["signed_out", "signed_in_locked", "unlocked"] as const)(
    "can be read when the session is %s, and shows every section",
    async (state) => {
      await renderApp("/privacy", testServices(state));

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Privacy and its limits",
        }),
      ).toBeTruthy();
      for (const each of PRIVACY) {
        expect(
          screen.getByRole("heading", { level: 2, name: each.heading }),
        ).toBeTruthy();
        expect(screen.getByText(each.text)).toBeTruthy();
      }
    },
  );

  it("is an open route: fixed words that show nothing private", () => {
    expect(ROUTES.find((route) => route.id === "privacy")?.access).toBe("open");
  });

  it("says what the servers cannot read and what they can see", () => {
    expect(section("What Warmly's servers cannot read")).toContain(
      "encrypted on your device before it is saved or synced",
    );
    expect(section("What Warmly's servers cannot read")).toContain(
      "do not have the key",
    );
    const visible = section("What Warmly's servers can see");
    for (const fact of [
      "the email address you signed up with",
      "which devices are on your account",
      "how many records you have",
      "how large each one is",
      "when it was changed",
      "They cannot see what any record says.",
    ]) {
      expect(visible).toContain(fact);
    }
  });

  it("says text sent to an AI provider is readable there and under its terms", () => {
    const text = section("When you ask AI for something");

    expect(text).toContain(
      "Nothing is sent to an AI provider unless you ask and then agree",
    );
    expect(text).toContain("as readable text");
    expect(text).toContain("They do not pass through Warmly's servers.");
    expect(text).toContain("governed by its own terms, not by Warmly");
  });

  it("says the same about deleting as Settings and the delete warning", () => {
    expect(section("When you delete something")).toBe(DELETING_STATUS);
    for (const promise of [
      "There is no trash and no undo.",
      "the next time they sync",
      "are removed as those backups expire, within 30 days.",
    ]) {
      expect(section("When you delete something")).toContain(promise);
      expect(DELETE_WARNING).toContain(promise);
    }
  });

  it("says a removed device that stays offline keeps its copy", () => {
    const text = section("When you remove a device");

    expect(text).toContain(
      "Removing it cannot erase what that device already holds.",
    );
    expect(text).toContain("If it stays offline, it keeps its copy.");
  });

  it("says a lost recovery key cannot be made good by Warmly or a password reset", () => {
    const text = section("If you lose your recovery key");

    expect(text).toContain("Warmly cannot do it for you");
    expect(text).toContain("Resetting your password does not bring it back.");
  });

  it("says a compromised device or extension defeats the protection, and promises no absolute secrecy", () => {
    const text = section("What encryption cannot protect");

    expect(text).toContain(
      "Someone who can use your unlocked device can read it.",
    );
    expect(text).toContain("harmful software on the device");
    expect(text).toContain(
      "a browser extension that is allowed to read the pages",
    );
    expect(section("No promise of absolute secrecy")).toBe(
      "No app can promise that. This page says what Warmly does and where its protection ends, so you can decide what to write here.",
    );
  });

  it("links to the page that says what Warmly is not, and is linked from it and from Settings", async () => {
    await renderApp("/privacy", testServices("signed_out"));
    expect(
      screen
        .getByRole("link", { name: "What Warmly is and is not" })
        .getAttribute("href"),
    ).toBe("/help");
    cleanup();

    await renderApp("/help", testServices("signed_out"));
    expect(
      screen
        .getByRole("link", { name: "Privacy and its limits" })
        .getAttribute("href"),
    ).toBe("/privacy");
    cleanup();

    await renderApp("/settings", testServices("unlocked"));
    expect(
      (
        await screen.findByRole("link", { name: "Privacy and its limits" })
      ).getAttribute("href"),
    ).toBe("/privacy");
  });
});
