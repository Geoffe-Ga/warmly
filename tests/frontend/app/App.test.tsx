import { cleanup, render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App, resolveView } from "../../../src/app/App";
import { Link } from "../../../src/app/navigation";
import { ROUTES, pathFor } from "../../../src/app/routes";

const SAMPLE_PARAMS = { id: "sample-1", cardId: "sample-2" };

function visit(path: string): void {
  window.history.replaceState(null, "", path);
}

describe("App", () => {
  beforeEach(() => {
    visit("/");
  });

  afterEach(() => {
    cleanup();
  });

  it("Home shows exactly the three primary actions, in order (UX-001)", () => {
    render(<App />);

    const primary = screen.getByRole("navigation", { name: "Primary" });
    const names = within(primary)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(names).toEqual(["Journal", "Reflect", "Prepare for a Conversation"]);
  });

  it("Home offers collections, settings and devices as secondary navigation (UX-001)", () => {
    render(<App />);

    const secondary = screen.getByRole("navigation", { name: "Secondary" });
    const names = within(secondary)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(names).toEqual(["Collections", "Settings", "Manage Devices"]);
  });

  it.each(ROUTES.map((route) => [route.id, route] as const))(
    "renders %s with one h1, a main landmark and its title",
    (_id, route) => {
      visit(pathFor(route.id, SAMPLE_PARAMS));
      render(<App />);

      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]?.textContent).toBe(route.title);
      expect(screen.getAllByRole("main")).toHaveLength(1);
      expect(document.title).toBe(
        route.id === "home" ? "Warmly" : `${route.title} · Warmly`,
      );
    },
  );

  it.each(
    ROUTES.filter((route) => route.id !== "home").map(
      (route) => [route.id, route] as const,
    ),
  )("gives %s a working link back to Home", async (_id, route) => {
    visit(pathFor(route.id, SAMPLE_PARAMS));
    render(<App />);

    await userEvent.click(screen.getByRole("link", { name: "Warmly home" }));

    expect(window.location.pathname).toBe("/");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeDefined();
  });

  it("navigates without a page load and moves focus to the new heading", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("link", { name: "Reflect" }));

    const heading = screen.getByRole("heading", { level: 1 });
    expect(window.location.pathname).toBe("/reflect");
    expect(heading.textContent).toBe("Reflect");
    expect(document.activeElement).toBe(heading);
  });

  it("does not steal focus on the first render", () => {
    render(<App />);

    expect(document.activeElement).toBe(document.body);
  });

  it("follows the browser back button", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Journal" }));

    window.history.back();
    await screen.findByRole("navigation", { name: "Primary" });

    expect(window.location.pathname).toBe("/");
  });

  it("leaves modified clicks to the browser", async () => {
    render(<App />);
    const user = userEvent.setup();
    // jsdom cannot open a new tab; stop it trying after the app has had its say.
    const stop = (event: Event): void => {
      event.preventDefault();
    };
    document.addEventListener("click", stop);

    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link", { name: "Journal" }));
    await user.keyboard("{/Control}");
    document.removeEventListener("click", stop);

    expect(window.location.pathname).toBe("/");
  });

  it("adds no history entry when a link points at the current screen", async () => {
    visit("/settings");
    render(<App />);
    const before = window.history.length;

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(window.history.length).toBe(before);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Settings",
    );
  });

  it("shows a not-found screen with a way home for an unknown path", () => {
    visit("/definitely/not/a/route");
    render(<App />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Page not found",
    );
    expect(screen.getByRole("link", { name: "Warmly home" })).toBeDefined();
  });

  it("makes no network request while rendering any screen (AC-03)", () => {
    const calls: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args);
      return Promise.reject(new Error("no network in tests"));
    }) as typeof fetch;

    try {
      for (const route of ROUTES) {
        visit(pathFor(route.id, SAMPLE_PARAMS));
        render(<App />);
        cleanup();
      }
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
  });

  it("marks the link to the current screen with aria-current", () => {
    visit("/settings");
    render(<App />);

    expect(
      screen
        .getByRole("link", { name: "Settings" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Collections" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("re-announces the screen when its own link is activated", async () => {
    visit("/settings");
    render(<App />);

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1 }),
    );
  });

  it.each(["//evil.example", "https://evil.example", "journal"])(
    "refuses to render a Link to %j",
    (href) => {
      expect(() => render(<Link href={href}>Out</Link>)).toThrow(
        /in-app paths/,
      );
    },
  );

  it("resolves the component gallery in a development build", () => {
    expect(resolveView("/dev/components").title).toBe("Component gallery");
    expect(resolveView("/dev/other").title).toBe("Page not found");
  });

  it("renders the component gallery with one h1 and working controls", async () => {
    visit("/dev/components");
    render(<App />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await userEvent.type(screen.getByLabelText("Device name"), "Phone");
    await userEvent.type(screen.getByLabelText("What's going well?"), "A lot");
    await userEvent.click(
      screen.getByRole("button", { name: "Delete sample" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("You cancelled.")).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete sample" }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete sample",
      }),
    );
    expect(screen.getByText("You chose to delete.")).toBeDefined();
    expect(screen.getByLabelText("Device name")).toHaveProperty(
      "value",
      "Phone",
    );
  });

  it("renders a Link outside the app as an inert, harmless anchor", async () => {
    render(<Link href="/journal">Journal</Link>);

    await userEvent.click(screen.getByRole("link", { name: "Journal" }));

    expect(window.location.pathname).toBe("/");
  });

  it("provides IndexedDB in the test environment", () => {
    expect(globalThis.indexedDB).toBeDefined();
  });
});
