/**
 * The Prepare screens against in-memory data (PRD CC-001, CC-007, CC-012,
 * CC-013; AC-23).
 */
import { cleanup, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pathFor } from "../../../src/app/routes";
import {
  MemoryCardsStore,
  type CardsStore,
} from "../../../src/domain/cards/store";
import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { SEED } from "../../../src/testing/seed-cards";
import { heading, renderApp, testServices, visit } from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function unlocked(cards?: CardsStore) {
  const services = testServices("unlocked");
  return cards === undefined ? services : { ...services, cards };
}

/** A store whose every answer fails. */
const BROKEN: CardsStore = {
  collections: () => Promise.reject(new Error("synthetic CANARY")),
  collection: () => Promise.reject(new Error("synthetic CANARY")),
  cards: () => Promise.reject(new Error("synthetic CANARY")),
  card: () => Promise.reject(new Error("synthetic CANARY")),
};

const SUNDAY = { id: SEED.sunday };

describe("Prepare for a Conversation: the collections (CC-001)", () => {
  it("is reached from Home", async () => {
    await renderApp("/", unlocked());

    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Prepare for a Conversation" }));

    expect(heading().textContent).toBe("Prepare for a Conversation");
    await screen.findByRole("navigation", { name: "Your collections" });
  });

  it("lists seeded collections and opens one", async () => {
    await renderApp("/prepare", unlocked());
    const list = await screen.findByRole("navigation", {
      name: "Your collections",
    });

    expect(
      within(list)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Sunday talk3 cards",
      "Money check-in1 card",
      "Not started yet0 cards",
    ]);

    await userEvent
      .setup()
      .click(within(list).getByRole("link", { name: /Sunday talk/ }));

    expect(heading().textContent).toBe("Sunday talk");
  });

  it("says so when there are no collections", async () => {
    await renderApp("/prepare", unlocked(new MemoryCardsStore()));

    await screen.findByText("You have no collections yet.");
    expect(
      screen.queryByRole("navigation", { name: "Your collections" }),
    ).toBeNull();
  });

  it("says so when the cards cannot be opened, without the error's text", async () => {
    await renderApp("/prepare", unlocked(BROKEN));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't open your cards");
    expect(document.body.textContent).not.toContain("CANARY");
  });
});

describe("one collection (CC-001, CC-010)", () => {
  it("shows its cards in order, each leading to the card", async () => {
    await renderApp(pathFor("collection", SUNDAY), unlocked());
    const list = await screen.findByRole("navigation", {
      name: "Cards in this collection",
    });
    const links = within(list).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual([
      "I loved cooking with you on Sunday. It made me feel close to you.Appreciation",
      "The last two weekends I did the shopping on my own. Could we plan next weekend's together on Thursday?Need and request",
      "What would make weekday evenings easier for you?Curiosity",
    ]);
    expect(links[1]?.getAttribute("href")).toBe(
      pathFor("card", { id: SEED.sunday, cardId: SEED.chores }),
    );
  });

  it("leads to presenting and printing", async () => {
    await renderApp(pathFor("collection", SUNDAY), unlocked());
    const use = await screen.findByRole("navigation", {
      name: "Use this collection",
    });

    expect(
      within(use)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([pathFor("present", SUNDAY), pathFor("print", SUNDAY)]);
  });

  it("says an empty collection is empty and offers nothing to present", async () => {
    await renderApp(pathFor("collection", { id: SEED.empty }), unlocked());

    await screen.findByText("This collection has no cards yet.");
    expect(heading().textContent).toBe("Not started yet");
    expect(
      screen.queryByRole("link", { name: "Present these cards" }),
    ).toBeNull();
  });

  it("keeps the plain title and says so when the collection is not here", async () => {
    await renderApp(pathFor("collection", { id: "sample-1" }), unlocked());

    await screen.findByText(/This collection isn't on this device/);
    expect(heading().textContent).toBe("Collection");
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Back to your collections" }));
    expect(heading().textContent).toBe("Prepare for a Conversation");
  });

  it("never puts the collection's name in the address or the tab title (SEC-007)", async () => {
    await renderApp(pathFor("collection", SUNDAY), unlocked());
    await screen.findByRole("navigation", { name: "Cards in this collection" });

    expect(window.location.href).not.toMatch(/Sunday/i);
    expect(document.title).not.toMatch(/Sunday/i);
  });

  it("reports a failure to open", async () => {
    await renderApp(pathFor("collection", SUNDAY), unlocked(BROKEN));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("one card (CC-007)", () => {
  const AI_CARD = { id: SEED.sunday, cardId: SEED.thanks };
  const OWN_CARD = { id: SEED.sunday, cardId: SEED.chores };

  it("shows what it says, its kind, its parts and that AI drafted it", async () => {
    await renderApp(pathFor("card", AI_CARD), unlocked());

    await screen.findByRole("heading", { name: "Appreciation" });
    expect(
      screen.getByText(
        "I loved cooking with you on Sunday. It made me feel close to you.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Drafted by AI from your journal. You can rewrite all of it.",
      ),
    ).toBeTruthy();
    const parts = screen.getByRole("list", { name: "The parts of this card" });
    expect(
      within(parts)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "appreciationI loved cooking with you on Sunday.",
      "feelingIt made me feel close to you.",
    ]);
  });

  it("says a manual card was written by the person", async () => {
    await renderApp(pathFor("card", OWN_CARD), unlocked());

    await screen.findByText("Written by you.");
    expect(screen.queryByText(/Drafted by AI/)).toBeNull();
  });

  it("leads back to its collection", async () => {
    await renderApp(pathFor("card", OWN_CARD), unlocked());
    await screen.findByText("Written by you.");

    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Back to the collection" }));

    expect(heading().textContent).toBe("Sunday talk");
  });

  it.each([
    ["a card that does not exist", { id: SEED.sunday, cardId: "sample-2" }],
    [
      "a card asked for through another collection",
      { id: SEED.money, cardId: SEED.thanks },
    ],
    [
      "a collection that does not exist",
      { id: "sample-1", cardId: SEED.thanks },
    ],
  ])("says so for %s", async (_name, params) => {
    await renderApp(pathFor("card", params), unlocked());

    await screen.findByText(/This card isn't on this device/);
    expect(heading().textContent).toBe("Card");
    expect(screen.queryByText(/cooking/)).toBeNull();
  });

  it("reports a failure to open", async () => {
    await renderApp(pathFor("card", AI_CARD), unlocked(BROKEN));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("presentation (CC-012)", () => {
  it("opens at the first card and moves one card at a time", async () => {
    await renderApp(pathFor("present", SUNDAY), unlocked());
    const user = userEvent.setup();

    await screen.findByText("Card 1 of 3");
    expect(screen.getByText(/I loved cooking with you/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Previous card" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Next card" }));
    await screen.findByText("Card 2 of 3");
    expect(screen.queryByText(/I loved cooking with you/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next card" }));
    await screen.findByText("Card 3 of 3");
    expect(
      screen
        .getByRole("button", { name: "Next card" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    // Pressing a button that leads nowhere changes nothing.
    await user.click(screen.getByRole("button", { name: "Next card" }));
    expect(screen.getByText("Card 3 of 3")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Previous card" }));
    await screen.findByText("Card 2 of 3");
  });

  it("shows only the words to say: no kind, no source notes, no explanations", async () => {
    await renderApp(pathFor("present", SUNDAY), unlocked());
    await screen.findByText("Card 1 of 3");

    const text = document.querySelector("main")?.textContent ?? "";
    expect(text).not.toMatch(/Appreciation|Drafted by AI|Naming one specific/);
  });

  it("always opens at card one again, and keeps no record of where the person was", async () => {
    const services = unlocked();
    await renderApp(pathFor("present", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByText("Card 1 of 3");
    await user.click(screen.getByRole("button", { name: "Next card" }));
    await screen.findByText("Card 2 of 3");

    // Nothing about the position is in the address or in storage.
    expect(window.location.pathname).toBe(pathFor("present", SUNDAY));
    expect(window.location.search).toBe("");
    expect(sessionStorage.length + localStorage.length).toBe(0);

    await user.click(
      screen.getByRole("link", { name: "Back to the collection" }),
    );
    await user.click(
      await screen.findByRole("link", { name: "Present these cards" }),
    );

    await screen.findByText("Card 1 of 3");
  });

  it("says so when there is nothing to present", async () => {
    await renderApp(pathFor("present", { id: SEED.empty }), unlocked());

    await screen.findByText("This collection has no cards to present yet.");
    expect(screen.queryByRole("button", { name: "Next card" })).toBeNull();
  });

  it("with one card, neither button leads anywhere", async () => {
    await renderApp(pathFor("present", { id: SEED.money }), unlocked());

    await screen.findByText("Card 1 of 1");
    for (const name of ["Previous card", "Next card"]) {
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-disabled"),
      ).toBe("true");
    }
  });

  it("says so when the collection is not here, or cannot be opened", async () => {
    await renderApp(pathFor("present", { id: "sample-1" }), unlocked());
    await screen.findByText(/This collection isn't on this device/);
    expect(heading().textContent).toBe("Presentation");
    cleanup();

    await renderApp(pathFor("present", SUNDAY), unlocked(BROKEN));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("print (CC-013)", () => {
  it("shows the collection's name and its card text, and nothing else about the cards", async () => {
    await renderApp(pathFor("print", SUNDAY), unlocked());
    const sheet = await screen.findByRole("region", {
      name: "What will be printed",
    });

    expect(
      within(sheet).getByRole("heading", { name: "Sunday talk" }),
    ).toBeTruthy();
    expect(
      within(sheet)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "I loved cooking with you on Sunday. It made me feel close to you.",
      "The last two weekends I did the shopping on my own. Could we plan next weekend's together on Thursday?",
      "What would make weekday evenings easier for you?",
    ]);
    expect(sheet.textContent).not.toMatch(
      /Appreciation|Drafted by AI|Naming one specific|paraphrase/,
    );
  });

  it("prints only when the person presses Print", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    await renderApp(pathFor("print", SUNDAY), unlocked());
    await screen.findByRole("region", { name: "What will be printed" });

    expect(print).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Print" }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to print for an empty or missing collection", async () => {
    await renderApp(pathFor("print", { id: SEED.empty }), unlocked());
    await screen.findByText("This collection has no cards to print yet.");
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    cleanup();

    await renderApp(pathFor("print", { id: "sample-1" }), unlocked());
    await screen.findByText(/This collection isn't on this device/);
    expect(heading().textContent).toBe("Print");
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    cleanup();

    await renderApp(pathFor("print", SUNDAY), unlocked(BROKEN));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("the Prepare screens never call AI (invariant 2)", () => {
  it("opening every one of them sends nothing to a provider", async () => {
    const provider = new FakeProvider();
    const services = { ...unlocked(), ai: new AiGateway(provider) };
    const paths = [
      "/prepare",
      pathFor("collection", SUNDAY),
      pathFor("card", { id: SEED.sunday, cardId: SEED.thanks }),
      pathFor("present", SUNDAY),
      pathFor("print", SUNDAY),
    ];

    for (const path of paths) {
      await renderApp(path, services);
      await screen.findAllByText(/Sunday talk|cooking with you/);
      cleanup();
    }

    expect(provider.calls).toEqual([]);
  });
});
