/**
 * Presentation keeps no record of what was shown (PRD CC-012; AC-14,
 * AC-03; invariant 4).
 */
import { cleanup, fireEvent, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { pathFor } from "../../../src/app/routes";
import {
  heading,
  renderApp,
  testServices,
  visit,
  type TestServices,
} from "../app/helpers";
import { SEED, seedCards } from "../app/seed-cards";

const SUNDAY = { id: SEED.sunday };
const PRESENT = pathFor("present", SUNDAY);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function presenting(): Promise<TestServices> {
  const services = testServices("unlocked");
  await seedCards(services.records);
  await renderApp(PRESENT, services);
  await screen.findByText("Card 1 of 3");
  return services;
}

function position(): string {
  return screen.getByText(/^Card \d+ of \d+$/).textContent ?? "";
}

/** Everything that could hold a trace of what was viewed. */
async function everything(services: TestServices): Promise<string> {
  return JSON.stringify({
    collections: await services.records.list("card-collection"),
    cards: await services.records.list("conversation-card"),
    entries: await services.records.list("journal-entry"),
    url: window.location.href,
    session: { ...sessionStorage },
    local: { ...localStorage },
    historyLength: window.history.length,
    historyState: window.history.state as unknown,
    cookie: document.cookie,
    title: document.title,
  });
}

describe("moving through the cards", () => {
  it("goes forward and back with the arrow keys, and stops at either end", async () => {
    await presenting();
    const user = userEvent.setup();

    await user.keyboard("{ArrowRight}");
    expect(position()).toBe("Card 2 of 3");
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(position()).toBe("Card 3 of 3");
    await user.keyboard("{ArrowLeft}");
    expect(position()).toBe("Card 2 of 3");
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(position()).toBe("Card 1 of 3");
  });

  it.each([
    ["Alt", { altKey: true }],
    ["Control", { ctrlKey: true }],
    ["Command", { metaKey: true }],
    ["Shift", { shiftKey: true }],
  ])(
    "leaves an arrow key alone when %s is held, for the browser to use",
    async (_name, held) => {
      await presenting();

      const handled = !fireEvent.keyDown(window, {
        key: "ArrowRight",
        ...held,
      });

      expect(handled).toBe(false);
      expect(position()).toBe("Card 1 of 3");
    },
  );

  it("ignores other keys", async () => {
    await presenting();

    await userEvent.setup().keyboard("{ArrowDown}{ArrowUp}{Home}{End}a ");

    expect(position()).toBe("Card 1 of 3");
  });

  it("says the arrow keys work", async () => {
    await presenting();

    expect(
      screen.getByText("You can also use the left and right arrow keys."),
    ).toBeTruthy();
  });

  it("stops listening for keys once the view is left", async () => {
    await presenting();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("link", { name: "Close and go back to the collection" }),
    );
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await user.click(screen.getByRole("link", { name: "Present these cards" }));

    expect(await screen.findByText("Card 1 of 3")).toBeTruthy();
  });
});

describe("nothing about the viewing is kept (CC-012, AC-14)", () => {
  it("always reopens at card one and persists no progress (AC-14)", async () => {
    const services = await presenting();
    const user = userEvent.setup();
    const before = await everything(services);

    await user.click(screen.getByRole("button", { name: "Next card" }));
    await user.keyboard("{ArrowRight}");
    expect(position()).toBe("Card 3 of 3");

    // While paging: the records, the address, storage, history and the
    // title are exactly as they were.
    expect(await everything(services)).toBe(before);

    await user.click(
      screen.getByRole("link", { name: "Close and go back to the collection" }),
    );
    await user.click(
      await screen.findByRole("link", { name: "Present these cards" }),
    );

    expect(await screen.findByText("Card 1 of 3")).toBeTruthy();
    expect(sessionStorage.length + localStorage.length).toBe(0);
    expect(window.history.state).toBeNull();
  });

  it("writes nothing to the record store while paging, so nothing is queued for sync", async () => {
    const services = await presenting();
    const put = vi.spyOn(services.records, "put");
    const remove = vi.spyOn(services.records, "delete");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Next card" }));
    await user.click(screen.getByRole("button", { name: "Next card" }));
    await user.click(screen.getByRole("button", { name: "Previous card" }));
    await user.keyboard("{ArrowRight}{ArrowLeft}");

    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("adds no entry to the browser's history while paging", async () => {
    await presenting();
    const pushed = vi.spyOn(window.history, "pushState");
    const replaced = vi.spyOn(window.history, "replaceState");

    await userEvent.setup().keyboard("{ArrowRight}{ArrowRight}{ArrowLeft}");

    expect(pushed).not.toHaveBeenCalled();
    expect(replaced).not.toHaveBeenCalled();
  });

  it("announces no event and calls no AI, while paging or on closing", async () => {
    const provider = new FakeProvider();
    const services = testServices("unlocked");
    await seedCards(services.records);
    const announced = vi.spyOn(services.events, "emit");
    await renderApp(PRESENT, { ...services, ai: new AiGateway(provider) });
    await screen.findByText("Card 1 of 3");
    const user = userEvent.setup();

    await user.keyboard("{ArrowRight}{ArrowRight}");
    await user.click(
      screen.getByRole("link", { name: "Close and go back to the collection" }),
    );

    expect(heading().textContent).toBe("Sunday talk");
    expect(announced).not.toHaveBeenCalled();
    expect(provider.calls).toEqual([]);
    // Closing starts nothing: no dialog, no prompt to write anything.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows nothing but the words, the position and the controls", async () => {
    await presenting();

    const main = document.querySelector("main");
    expect(
      [...(main?.querySelectorAll("button") ?? [])].map(
        (button) => button.textContent,
      ),
    ).toEqual(["Previous card", "Next card"]);
    expect(main?.textContent).not.toMatch(
      /Appreciation|Drafted by AI|Naming one specific|seconds|minutes|viewed|done/i,
    );
  });

  it("stays on a card that still exists when the collection shrinks under it", async () => {
    const services = await presenting();
    await userEvent.setup().keyboard("{ArrowRight}{ArrowRight}");
    expect(position()).toBe("Card 3 of 3");

    // As sync would: the last card is deleted on another device.
    await services.records.delete("conversation-card", SEED.wondering);

    expect(await screen.findByText("Card 2 of 2")).toBeTruthy();
  });
});
