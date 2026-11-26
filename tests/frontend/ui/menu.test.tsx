/**
 * The menu in the top bar: a button and a panel that is in the page only
 * while open (PRD UX-001, UI-002; issue #136).
 */
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Menu } from "../../../src/ui/components/Menu";
import { openMenu, renderApp, testServices } from "../app/helpers";

afterEach(() => {
  cleanup();
});

function open(): HTMLElement {
  return screen.getByRole("button", { name: "Menu" });
}

function renderMenu(): void {
  render(
    <div>
      <Menu label="Menu">
        <a href="/somewhere">A link</a>
        <button type="button">A button</button>
      </Menu>
      <p>Outside</p>
    </div>,
  );
}

describe("the menu", () => {
  it("is closed to begin with: its contents are not in the page", () => {
    renderMenu();

    expect(open().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "A link" })).toBeNull();
  });

  it("opens under its button, which says so and names the panel it controls", async () => {
    renderMenu();

    await userEvent.click(open());

    expect(open().getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(
      open().getAttribute("aria-controls") ?? "",
    );
    expect(panel?.contains(screen.getByRole("link", { name: "A link" }))).toBe(
      true,
    );
  });

  it("opens and closes from the keyboard, and the next Tab goes into the open panel", async () => {
    renderMenu();
    open().focus();

    await userEvent.keyboard("{Enter}");
    expect(open().getAttribute("aria-expanded")).toBe("true");
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "A link" }),
    );

    open().focus();
    await userEvent.keyboard(" ");
    expect(open().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and gives the focus back to its button", async () => {
    renderMenu();
    await userEvent.click(open());
    screen.getByRole("button", { name: "A button" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(open().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(open());
  });

  it("closes on a press outside it, and not on a press inside it", async () => {
    renderMenu();
    await userEvent.click(open());

    await userEvent.click(screen.getByRole("button", { name: "A button" }));
    expect(open().getAttribute("aria-expanded")).toBe("true");

    await userEvent.click(screen.getByText("Outside"));
    expect(open().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when a link in it is followed", async () => {
    renderMenu();
    await userEvent.click(open());
    const link = screen.getByRole("link", { name: "A link" });
    link.addEventListener("click", (event) => {
      event.preventDefault();
    });

    await userEvent.click(link);

    expect(open().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the top bar while unlocked (UX-001, PRD §4.3)", () => {
  it("has Lock outside the menu, and Sync now and Sign out inside it", async () => {
    await renderApp("/journal", testServices("unlocked"));

    expect(screen.getByRole("button", { name: "Lock" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    // Where sync stands is said in the bar itself, menu closed.
    expect(document.querySelector(".sync-status")?.textContent).toContain(
      "All changes saved",
    );

    await openMenu();

    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
    // Lock did not move into the menu.
    expect(
      document
        .querySelector(".menu__panel")
        ?.contains(screen.getByRole("button", { name: "Lock" })),
    ).toBe(false);
  });

  it("closes the menu when one of its links is followed, and shows that screen", async () => {
    await renderApp("/journal", testServices("unlocked"));
    await openMenu();

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(window.location.pathname).toBe("/settings");
    expect(open().getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["signed_out", "signed_in_locked"] as const)(
    "has no menu while %s",
    async (state) => {
      await renderApp("/", testServices(state));

      expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    },
  );
});
