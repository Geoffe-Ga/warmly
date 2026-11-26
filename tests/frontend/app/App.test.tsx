import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../../src/app/App";
import { Link } from "../../../src/app/navigation";
import { ROUTES, pathFor } from "../../../src/app/routes";
import { useServices } from "../../../src/app/services";

import {
  ACCOUNT,
  SAMPLE_PARAMS,
  heading,
  openMenu,
  renderApp,
  testServices,
  visit,
} from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

describe("App shell while unlocked", () => {
  it("Home shows exactly the three primary actions, in order (UX-001)", async () => {
    await renderApp("/", testServices("unlocked"));

    const primary = screen.getByRole("navigation", { name: "Primary" });
    const names = within(primary)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(names).toEqual(["Journal", "Reflect", "Prepare for a Conversation"]);
  });

  it("offers collections, settings and devices as secondary navigation (UX-001)", async () => {
    await renderApp("/", testServices("unlocked"));
    // It is in the menu, so the page itself comes first on every screen.
    expect(screen.queryByRole("navigation", { name: "Secondary" })).toBeNull();
    await openMenu();

    const secondary = screen.getByRole("navigation", { name: "Secondary" });
    const names = within(secondary)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(names).toEqual([
      "Collections",
      "Settings",
      "Manage Devices",
      "What Warmly is and is not",
      "Privacy and its limits",
    ]);
  });

  it.each(
    ROUTES.filter((route) => route.access === "private").map(
      (route) => [route.id, route] as const,
    ),
  )(
    "renders %s with one h1, a main landmark and its title",
    async (_id, route) => {
      await renderApp(
        pathFor(route.id, SAMPLE_PARAMS),
        testServices("unlocked"),
      );

      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(heading().textContent).toBe(route.title);
      expect(screen.getAllByRole("main")).toHaveLength(1);
      await waitFor(() => {
        expect(document.title).toBe(
          route.id === "home" ? "Warmly" : `${route.title} · Warmly`,
        );
      });
    },
  );

  it("links back to Home from another screen", async () => {
    await renderApp("/settings", testServices("unlocked"));

    await userEvent.click(screen.getByRole("link", { name: "Warmly home" }));

    expect(window.location.pathname).toBe("/");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeDefined();
  });

  it("navigates without a page load and moves focus to the new heading", async () => {
    await renderApp("/", testServices("unlocked"));

    await userEvent.click(screen.getByRole("link", { name: "Reflect" }));

    expect(window.location.pathname).toBe("/reflect");
    expect(heading().textContent).toBe("Reflect");
    expect(document.activeElement).toBe(heading());
  });

  it("does not steal focus on the first render", async () => {
    await renderApp("/", testServices("unlocked"));

    expect(document.activeElement).toBe(document.body);
  });

  it("follows the browser back button", async () => {
    await renderApp("/", testServices("unlocked"));
    await userEvent.click(screen.getByRole("link", { name: "Journal" }));

    window.history.back();
    await screen.findByRole("navigation", { name: "Primary" });

    expect(window.location.pathname).toBe("/");
  });

  it("leaves modified clicks to the browser", async () => {
    await renderApp("/", testServices("unlocked"));
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
    await renderApp("/settings", testServices("unlocked"));
    const before = window.history.length;

    await openMenu();
    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(window.history.length).toBe(before);
    expect(heading().textContent).toBe("Settings");
    expect(document.activeElement).toBe(heading());
  });

  it("marks the link to the current screen with aria-current", async () => {
    await renderApp("/settings", testServices("unlocked"));
    await openMenu();

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

  it("shows a not-found screen for an unknown path", async () => {
    await renderApp("/definitely/not/a/route", testServices("unlocked"));

    expect(heading().textContent).toBe("Page not found");
    expect(screen.getByRole("link", { name: "Warmly home" })).toBeDefined();
  });

  it("renders the component gallery with working controls", async () => {
    await renderApp("/dev/components", testServices("unlocked"));

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
  });
});

describe("App access control (DEV-005, UI-008)", () => {
  it.each(
    ROUTES.filter((route) => route.access === "private").map(
      (route) => [route.id, route] as const,
    ),
  )("sends a signed-out visitor from %s to sign in", async (_id, route) => {
    await renderApp(pathFor(route.id, SAMPLE_PARAMS));

    expect(window.location.pathname).toBe("/sign-in");
    expect(heading().textContent).toBe("Sign in");
    expect(screen.queryByText(route.summary)).toBeNull();
  });

  it.each(
    ROUTES.filter((route) => route.access === "private").map(
      (route) => [route.id, route] as const,
    ),
  )(
    "sends a locked visitor from %s to the locked screen",
    async (_id, route) => {
      await renderApp(
        pathFor(route.id, SAMPLE_PARAMS),
        testServices("signed_in_locked"),
      );

      expect(window.location.pathname).toBe("/locked");
      expect(heading().textContent).toBe("Warmly is locked");
      expect(screen.queryByText(route.summary)).toBeNull();
    },
  );

  it("replaces the history entry, so Back cannot return to the refused screen", async () => {
    const before = window.history.length;

    await renderApp("/journal");

    expect(window.history.length).toBe(before);
  });

  it("offers no navigation into private screens while signed out or locked", async () => {
    await renderApp("/sign-in");

    expect(screen.queryByRole("navigation", { name: "Secondary" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Warmly home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("sends an unlocked visitor away from sign-in to Home", async () => {
    await renderApp("/sign-in", testServices("unlocked"));

    expect(window.location.pathname).toBe("/");
  });

  it("restores a signed-in session after a reload as locked, never unlocked", async () => {
    const services = testServices();
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    await services.auth.completeVerification();

    await renderApp("/journal", services);

    expect(services.session.state).toBe("signed_in_locked");
    expect(window.location.pathname).toBe("/locked");
  });

  it("shows a neutral screen until the session has been restored", () => {
    visit("/journal");
    render(<App services={testServices()} />);

    expect(heading().textContent).toBe("Opening Warmly");
    expect(window.location.pathname).toBe("/journal");
  });
});

describe("Lock and Sign out (DEV-005)", () => {
  it("Lock is available on every private screen and hides it at once", async () => {
    const services = await renderApp("/journal", testServices("unlocked"));
    await services.vault.createAccountKeys();
    expect(screen.getByText("Your entries, newest first.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Lock" }));

    expect(services.session.state).toBe("signed_in_locked");
    expect(services.vault.isUnlocked).toBe(false);
    expect(window.location.pathname).toBe("/locked");
    expect(screen.queryByText("Your entries, newest first.")).toBeNull();
    expect(document.activeElement).toBe(heading());
  });

  it("Sign out ends the session and drops the keys", async () => {
    const services = testServices("unlocked");
    await services.auth.register(ACCOUNT.email, ACCOUNT.password);
    await services.auth.completeVerification();
    await services.vault.createAccountKeys();
    await renderApp("/settings", services);

    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });

    expect(services.session.state).toBe("signed_out");
    expect(services.vault.isUnlocked).toBe(false);
    expect(await services.auth.isSignedIn()).toBe(false);
    expect(window.location.pathname).toBe("/sign-in");
  });

  it("signs out on this device even when the server cannot be reached", async () => {
    const services = testServices("unlocked");
    await services.vault.createAccountKeys();
    services.auth.signOut = () => Promise.reject(new Error("offline"));
    await renderApp("/settings", services);

    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });

    expect(services.session.state).toBe("signed_out");
    expect(services.vault.isUnlocked).toBe(false);
    expect(window.location.pathname).toBe("/sign-in");
  });

  it("Sign out closes private screens before the server answers", async () => {
    const services = testServices("unlocked");
    await services.vault.createAccountKeys();
    services.auth.signOut = () => new Promise<void>(() => undefined);
    await renderApp("/settings", services);

    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(services.session.state).toBe("signed_out");
    expect(services.vault.isUnlocked).toBe(false);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("Sign out still works, quietly, when the server cannot be told", async () => {
    const services = testServices("unlocked");
    services.auth.signOut = () => Promise.reject(new Error("offline"));
    const failures: unknown[] = [];
    const onFailure = (event: PromiseRejectionEvent): void => {
      failures.push(event.reason);
    };
    window.addEventListener("unhandledrejection", onFailure);
    await renderApp("/settings", services);

    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("unhandledrejection", onFailure);

    expect(failures).toEqual([]);
    expect(services.session.state).toBe("signed_out");
  });

  it("starts signed out when the session cannot be restored", async () => {
    const services = testServices();
    services.auth.isSignedIn = () => Promise.reject(new Error("offline"));

    await renderApp("/journal", services);

    expect(services.session.state).toBe("signed_out");
    expect(window.location.pathname).toBe("/sign-in");
  });

  it("a locked user can sign out but has no Lock button", async () => {
    await renderApp("/locked", testServices("signed_in_locked"));

    expect(screen.queryByRole("button", { name: "Lock" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  });
});

describe("Link and services plumbing", () => {
  it.each(["//evil.example", "https://evil.example", "journal"])(
    "refuses to render a Link to %j",
    (href) => {
      expect(() => render(<Link href={href}>Out</Link>)).toThrow(
        /in-app paths/,
      );
    },
  );

  it("renders a Link outside the app as an inert, harmless anchor", async () => {
    render(<Link href="/journal">Journal</Link>);

    await userEvent.click(screen.getByRole("link", { name: "Journal" }));

    expect(window.location.pathname).toBe("/");
  });

  it("fails loudly when a screen is used without services", () => {
    function Orphan(): null {
      useServices();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(/ServicesProvider/);
  });

  it("makes no network request while rendering any screen (AC-03)", async () => {
    for (const route of ROUTES) {
      const state = route.access === "private" ? "unlocked" : "signed_out";
      await renderApp(pathFor(route.id, SAMPLE_PARAMS), testServices(state));
      cleanup();
    }
    // The network guard in tests/frontend/setup.ts throws on any attempt, so
    // reaching this line is the assertion.
    expect(true).toBe(true);
  });

  it("provides IndexedDB in the test environment", () => {
    expect(globalThis.indexedDB).toBeDefined();
  });
});
