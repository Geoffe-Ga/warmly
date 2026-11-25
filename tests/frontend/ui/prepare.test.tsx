/**
 * The Prepare screens against in-memory data (PRD CC-001, CC-007, CC-012,
 * CC-013; AC-23).
 */
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { pathFor } from "../../../src/app/routes";
import type { CardsStore } from "../../../src/domain/cards/store";
import { readingText } from "../../../src/domain/cards/types";
import { StaleRecordError } from "../../../src/storage/record-store";
import { StorageError } from "../../../src/storage/errors";
import { DELETE_WARNING } from "../../../src/ui/screens/journal/Entry";
import { STRAYS_EXPLAINED } from "../../../src/ui/screens/prepare/Collections";
import {
  NAME_NEEDED,
  NOT_SAVED,
  OUT_OF_DATE,
  TEXT_NEEDED,
} from "../../../src/ui/screens/prepare/shared";
import {
  heading,
  renderApp,
  testServices,
  visit,
  type TestServices,
} from "../app/helpers";
import { SEED, seedCards } from "../app/seed-cards";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Unlocked services holding the invented cards, no cards at all, or a
 * cards store of the test's own.
 */
async function unlocked(
  cards: CardsStore | "empty" | "seeded" = "seeded",
): Promise<TestServices> {
  const services = testServices("unlocked");
  if (cards === "seeded") {
    await seedCards(services.records);
  }
  return typeof cards === "string" ? services : { ...services, cards };
}

/** A store whose every answer fails. */
const BROKEN: CardsStore = {
  collections: () => Promise.reject(new Error("synthetic CANARY")),
  collection: () => Promise.reject(new Error("synthetic CANARY")),
  cards: () => Promise.reject(new Error("synthetic CANARY")),
  card: () => Promise.reject(new Error("synthetic CANARY")),
  strays: () => Promise.reject(new Error("synthetic CANARY")),
  subscribe: () => () => undefined,
};

const SUNDAY = { id: SEED.sunday };

describe("Prepare for a Conversation: the collections (CC-001)", () => {
  it("is reached from Home", async () => {
    await renderApp("/", await unlocked());

    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Prepare for a Conversation" }));

    expect(heading().textContent).toBe("Prepare for a Conversation");
    await screen.findByRole("navigation", { name: "Your collections" });
  });

  it("lists seeded collections and opens one", async () => {
    await renderApp("/prepare", await unlocked());
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
    await renderApp("/prepare", await unlocked("empty"));

    await screen.findByText("You have no collections yet.");
    expect(
      screen.queryByRole("navigation", { name: "Your collections" }),
    ).toBeNull();
  });

  it("says so when the cards cannot be opened, without the error's text", async () => {
    await renderApp("/prepare", await unlocked(BROKEN));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't open your cards");
    expect(document.body.textContent).not.toContain("CANARY");
  });
});

describe("one collection (CC-001, CC-010)", () => {
  it("shows its cards in order, each leading to the card", async () => {
    await renderApp(pathFor("collection", SUNDAY), await unlocked());
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
    await renderApp(pathFor("collection", SUNDAY), await unlocked());
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
    await renderApp(
      pathFor("collection", { id: SEED.empty }),
      await unlocked(),
    );

    await screen.findByText("This collection has no cards yet.");
    expect(heading().textContent).toBe("Not started yet");
    expect(
      screen.queryByRole("link", { name: "Present these cards" }),
    ).toBeNull();
  });

  it("keeps the plain title and says so when the collection is not here", async () => {
    await renderApp(
      pathFor("collection", { id: "sample-1" }),
      await unlocked(),
    );

    await screen.findByText(/This collection isn't on this device/);
    expect(heading().textContent).toBe("Collection");
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Back to your collections" }));
    expect(heading().textContent).toBe("Prepare for a Conversation");
  });

  it("never puts the collection's name in the address or the tab title (SEC-007)", async () => {
    await renderApp(pathFor("collection", SUNDAY), await unlocked());
    await screen.findByRole("navigation", { name: "Cards in this collection" });

    expect(window.location.href).not.toMatch(/Sunday/i);
    expect(document.title).not.toMatch(/Sunday/i);
  });

  it("reports a failure to open", async () => {
    await renderApp(pathFor("collection", SUNDAY), await unlocked(BROKEN));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("one card (CC-007)", () => {
  const AI_CARD = { id: SEED.sunday, cardId: SEED.thanks };
  const OWN_CARD = { id: SEED.sunday, cardId: SEED.chores };

  it("shows what it says, its kind, its parts and that AI drafted it", async () => {
    await renderApp(pathFor("card", AI_CARD), await unlocked());

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
    await renderApp(pathFor("card", OWN_CARD), await unlocked());

    await screen.findByText("Written by you.");
    expect(screen.queryByText(/Drafted by AI/)).toBeNull();
  });

  it("leads back to its collection", async () => {
    await renderApp(pathFor("card", OWN_CARD), await unlocked());
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
    await renderApp(pathFor("card", params), await unlocked());

    await screen.findByText(/This card isn't on this device/);
    expect(heading().textContent).toBe("Card");
    expect(screen.queryByText(/cooking/)).toBeNull();
  });

  it("reports a failure to open", async () => {
    await renderApp(pathFor("card", AI_CARD), await unlocked(BROKEN));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("presentation (CC-012)", () => {
  it("opens at the first card and moves one card at a time", async () => {
    await renderApp(pathFor("present", SUNDAY), await unlocked());
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
    await renderApp(pathFor("present", SUNDAY), await unlocked());
    await screen.findByText("Card 1 of 3");

    const text = document.querySelector("main")?.textContent ?? "";
    expect(text).not.toMatch(/Appreciation|Drafted by AI|Naming one specific/);
  });

  it("always opens at card one again, and keeps no record of where the person was", async () => {
    const services = await unlocked();
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
      screen.getByRole("link", { name: "Close and go back to the collection" }),
    );
    await user.click(
      await screen.findByRole("link", { name: "Present these cards" }),
    );

    await screen.findByText("Card 1 of 3");
  });

  it("says so when there is nothing to present", async () => {
    await renderApp(pathFor("present", { id: SEED.empty }), await unlocked());

    await screen.findByText("This collection has no cards to present yet.");
    expect(screen.queryByRole("button", { name: "Next card" })).toBeNull();
  });

  it("with one card, neither button leads anywhere", async () => {
    await renderApp(pathFor("present", { id: SEED.money }), await unlocked());

    await screen.findByText("Card 1 of 1");
    for (const name of ["Previous card", "Next card"]) {
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-disabled"),
      ).toBe("true");
    }
  });

  it("says so when the collection is not here, or cannot be opened", async () => {
    await renderApp(pathFor("present", { id: "sample-1" }), await unlocked());
    await screen.findByText(/This collection isn't on this device/);
    expect(heading().textContent).toBe("Presentation");
    cleanup();

    await renderApp(pathFor("present", SUNDAY), await unlocked(BROKEN));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("print (CC-013)", () => {
  it("shows the collection's name and its card text, and nothing else about the cards", async () => {
    await renderApp(pathFor("print", SUNDAY), await unlocked());
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
    await renderApp(pathFor("print", SUNDAY), await unlocked());
    await screen.findByRole("region", { name: "What will be printed" });

    expect(print).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Print" }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to print for an empty or missing collection", async () => {
    await renderApp(pathFor("print", { id: SEED.empty }), await unlocked());
    await screen.findByText("This collection has no cards to print yet.");
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    cleanup();

    await renderApp(pathFor("print", { id: "sample-1" }), await unlocked());
    await screen.findByText(/This collection isn't on this device/);
    expect(heading().textContent).toBe("Print");
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    cleanup();

    await renderApp(pathFor("print", SUNDAY), await unlocked(BROKEN));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't open your cards",
    );
  });
});

describe("the Prepare screens never call AI (invariant 2)", () => {
  it("opening every one of them sends nothing to a provider", async () => {
    const provider = new FakeProvider();
    const services = { ...(await unlocked()), ai: new AiGateway(provider) };
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

async function cardTexts(
  services: TestServices,
  id: string,
): Promise<string[]> {
  return (await services.cards.cards(id)).map(readingText);
}

function rows(): HTMLElement[] {
  return within(
    screen.getByRole("navigation", { name: "Cards in this collection" }),
  ).getAllByRole("listitem");
}

function rowTexts(): string[] {
  return rows().map(
    (row) => within(row).getByRole("link").firstChild?.textContent ?? "",
  );
}

describe("starting a collection (CC-001)", () => {
  it("creates a collection, lists it, clears the box and says so", async () => {
    const services = await unlocked("empty");
    await renderApp("/prepare", services);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^Name/), "Sunday talk");
    await user.click(screen.getByRole("button", { name: "Create collection" }));

    const list = await screen.findByRole("navigation", {
      name: "Your collections",
    });
    expect(within(list).getByRole("link").textContent).toBe(
      "Sunday talk0 cards",
    );
    expect(screen.getByLabelText(/^Name/)).toHaveProperty("value", "");
    expect(screen.getByText("Collection created.")).toBeTruthy();
    expect(await services.records.list("card-collection")).toHaveLength(1);
  });

  it("asks for a name, keeps what was typed, and stores nothing", async () => {
    const services = await unlocked("empty");
    await renderApp("/prepare", services);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Create collection" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      NAME_NEEDED,
    );

    const long = "n".repeat(81);
    await user.type(screen.getByLabelText(/^Name/), long);
    await user.click(screen.getByRole("button", { name: "Create collection" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      NAME_NEEDED,
    );
    expect(screen.getByLabelText(/^Name/)).toHaveProperty("value", long);
    expect(await services.records.list("card-collection")).toEqual([]);
  });

  it.each([
    [
      "the device is full",
      new StorageError("full", "synthetic"),
      /couldn't save this, because the device has no room left/,
    ],
    ["something unexpected", new Error("synthetic CANARY"), NOT_SAVED],
  ])(
    "says what happened when %s, keeps the name on the page, and never shows the error's text",
    async (_name, failure, message) => {
      const services = await unlocked("empty");
      services.records.put = () => Promise.reject(failure);
      await renderApp("/prepare", services);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/^Name/), "Kept on the page");
      await user.click(
        screen.getByRole("button", { name: "Create collection" }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(message);
      expect(document.body.textContent).not.toContain("CANARY");
      expect(screen.getByLabelText(/^Name/)).toHaveProperty(
        "value",
        "Kept on the page",
      );
      expect(screen.queryByText("Collection created.")).toBeNull();
    },
  );

  it("shows a collection made elsewhere without a reload", async () => {
    const services = await unlocked("empty");
    await renderApp("/prepare", services);
    await screen.findByText("You have no collections yet.");

    // As sync or another tab would.
    await seedCards(services.records);

    await waitFor(() => {
      expect(
        within(
          screen.getByRole("navigation", { name: "Your collections" }),
        ).getAllByRole("link"),
      ).toHaveLength(3);
    });
  });
});

describe("writing a card by hand (CC-010)", () => {
  it("adds the card at the end, clears the box and makes no AI call", async () => {
    const provider = new FakeProvider();
    const services = { ...(await unlocked()), ai: new AiGateway(provider) };
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Cards in this collection" });

    await user.type(
      screen.getByLabelText(/What do you want to say/),
      "Thank you for Thursday.",
    );
    await user.click(screen.getByRole("radio", { name: "Appreciation" }));
    await user.click(screen.getByRole("button", { name: "Add card" }));

    await waitFor(() => {
      expect(rows()).toHaveLength(4);
    });
    expect(rowTexts().at(-1)).toBe("Thank you for Thursday.");
    expect(within(rows()[3] as HTMLElement).getByRole("link").textContent).toBe(
      "Thank you for Thursday.Appreciation",
    );
    expect(screen.getByLabelText(/What do you want to say/)).toHaveProperty(
      "value",
      "",
    );
    expect(screen.getByText("Card added at the end.")).toBeTruthy();
    const added = (await services.cards.cards(SEED.sunday)).at(-1);
    expect(added).toMatchObject({
      authorship: "user_owned",
      type: "appreciation",
      sourceEntryIds: [],
    });
    expect(provider.calls).toEqual([]);
  });

  it("adds the first card to an empty collection", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", { id: SEED.empty }), services);
    const user = userEvent.setup();
    await screen.findByText("This collection has no cards yet.");

    await user.type(screen.getByLabelText(/What do you want to say/), "First.");
    await user.click(screen.getByRole("button", { name: "Add card" }));

    await waitFor(() => {
      expect(rowTexts()).toEqual(["First."]);
    });
    expect(
      screen.getByRole("link", { name: "Present these cards" }),
    ).toBeTruthy();
  });

  it("asks for some words, keeps what was typed, and stores nothing", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Cards in this collection" });

    await user.type(screen.getByLabelText(/What do you want to say/), "   ");
    await user.click(screen.getByRole("button", { name: "Add card" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      TEXT_NEEDED,
    );
    expect(screen.getByLabelText(/What do you want to say/)).toHaveProperty(
      "value",
      "   ",
    );
    expect(await cardTexts(services, SEED.sunday)).toHaveLength(3);
  });
});

describe("moving cards (CC-010, AC-13)", () => {
  it("moves a card with the keyboard and announces the new position (AC-13)", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    const before = rowTexts();

    const down = within(rows()[0] as HTMLElement).getByRole("button", {
      name: /move down/i,
    });
    down.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(rowTexts()).toEqual([before[1], before[0], before[2]]);
    });
    expect(
      screen.getByText(/moved to position 2 of 3/i).getAttribute("role"),
    ).toBe("status");
    expect(await cardTexts(services, SEED.sunday)).toEqual([
      before[1],
      before[0],
      before[2],
    ]);
  });

  it("moves a card up, and says where each button's card is", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    const before = rowTexts();

    await user.click(
      within(rows()[2] as HTMLElement).getByRole("button", {
        name: "Move up: card 3 of 3",
      }),
    );

    await waitFor(() => {
      expect(rowTexts()).toEqual([before[0], before[2], before[1]]);
    });
    expect(screen.getByText("Moved to position 2 of 3.")).toBeTruthy();
  });

  it("the first card cannot move up and the last cannot move down", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    const before = rowTexts();
    const up = within(rows()[0] as HTMLElement).getByRole("button", {
      name: /move up/i,
    });
    const down = within(rows()[2] as HTMLElement).getByRole("button", {
      name: /move down/i,
    });

    expect(up.getAttribute("aria-disabled")).toBe("true");
    expect(down.getAttribute("aria-disabled")).toBe("true");
    await user.click(up);
    await user.click(down);

    expect(rowTexts()).toEqual(before);
    expect(screen.queryByText(/Moved to position/)).toBeNull();
  });

  it("moves a card by dragging it onto another, carrying only its ID", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    const before = rowTexts();
    const carried = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => {
        carried.set(type, value);
      },
      getData: (type: string) => carried.get(type) ?? "",
    };

    fireEvent.dragStart(rows()[2] as HTMLElement, { dataTransfer });
    fireEvent.dragOver(rows()[0] as HTMLElement, { dataTransfer });
    fireEvent.drop(rows()[0] as HTMLElement, { dataTransfer });

    await waitFor(() => {
      expect(rowTexts()).toEqual([before[2], before[0], before[1]]);
    });
    expect([...carried.entries()]).toEqual([["text/plain", SEED.wondering]]);
    expect(screen.getByText("Moved to position 1 of 3.")).toBeTruthy();
  });

  it("dropping a card on itself, or something that is not a card, changes nothing", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    const before = rowTexts();
    const own = { getData: () => SEED.thanks, setData: () => undefined };
    const foreign = { getData: () => "", setData: () => undefined };
    const unknown = { getData: () => "not-a-card", setData: () => undefined };

    fireEvent.drop(rows()[0] as HTMLElement, { dataTransfer: own });
    fireEvent.drop(rows()[1] as HTMLElement, { dataTransfer: foreign });
    fireEvent.drop(rows()[1] as HTMLElement, { dataTransfer: unknown });
    fireEvent.drop(rows()[1] as HTMLElement);

    await waitFor(() => {
      expect(rowTexts()).toEqual(before);
    });
    expect(screen.queryByText(/Moved to position/)).toBeNull();
    expect((await services.cards.collection(SEED.sunday))?.updatedAt).toBe(
      "2026-11-01T09:00:00.000Z",
    );
  });

  it("says so when the collection changed elsewhere, and writes nothing over it", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    const before = rowTexts();
    services.records.put = () => Promise.reject(new StaleRecordError());

    await user.click(
      within(rows()[0] as HTMLElement).getByRole("button", {
        name: /move down/i,
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      OUT_OF_DATE,
    );
    expect(rowTexts()).toEqual(before);
  });

  it("after such a refusal, reads what is stored again and shows it, without trying the change again", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Cards in this collection" });
    const put = services.records.put.bind(services.records);
    let attempts = 0;
    services.records.put = () => {
      attempts += 1;
      return Promise.reject(new StaleRecordError());
    };
    const reloaded: string[] = [];
    // The stored collection is newer than the one on screen: reading it
    // again is how the screen learns its new name.
    services.records.reload = (async (kind: "card-collection", id: string) => {
      reloaded.push(kind);
      const stored = await services.records.get(kind, id);
      if (
        kind === "card-collection" &&
        id === SEED.sunday &&
        stored !== undefined
      ) {
        const newer = { ...stored, name: "Renamed in another tab" };
        await put(kind, newer);
        return newer;
      }
      return stored;
    }) as typeof services.records.reload;

    await user.click(
      within(rows()[0] as HTMLElement).getByRole("button", {
        name: /move down/i,
      }),
    );

    await screen.findByRole("alert");
    await waitFor(() => {
      expect(heading().textContent).toBe("Renamed in another tab");
    });
    expect(reloaded).toContain("card-collection");
    expect(reloaded).toContain("conversation-card");
    expect(attempts).toBe(1);
  });
});

describe("renaming and deleting a collection (CC-010)", () => {
  it("renames without asking, and the heading follows", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Collection name");
    expect(box).toHaveProperty("value", "Sunday talk");

    await user.clear(box);
    await user.type(box, "Weekend talk");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(heading().textContent).toBe("Weekend talk");
    });
    expect(screen.getByText("Renamed.")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await cardTexts(services, SEED.sunday)).toHaveLength(3);
  });

  it("follows a name changed elsewhere, unless a different one is being typed", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Collection name");
    const rename = async (name: string): Promise<void> => {
      const stored = await services.cards.collection(SEED.sunday);
      await services.records.put("card-collection", {
        ...(stored as NonNullable<typeof stored>),
        name,
      });
    };

    // As sync would.
    await rename("From my phone");
    await waitFor(() => {
      expect(box).toHaveProperty("value", "From my phone");
    });

    await user.type(box, " and more");
    await rename("From my phone again");
    await waitFor(() => {
      expect(heading().textContent).toBe("From my phone again");
    });
    expect(box).toHaveProperty("value", "From my phone and more");
  });

  it("refuses an empty name and keeps the old one", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();

    await user.clear(await screen.findByLabelText("Collection name"));
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      NAME_NEEDED,
    );
    expect((await services.cards.collection(SEED.sunday))?.name).toBe(
      "Sunday talk",
    );
  });

  it("asks before deleting, says how many cards go and what deleting means, and cancelling keeps everything", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete this collection" }),
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Its 3 cards are deleted with it.");
    expect(dialog.textContent).toContain(DELETE_WARNING);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await services.cards.collection(SEED.sunday)).toBeDefined();
    expect(await cardTexts(services, SEED.sunday)).toHaveLength(3);
  });

  it.each([
    [SEED.money, "Its 1 card is deleted with it."],
    [SEED.empty, "This collection has no cards."],
  ])("words the count for collection %s", async (id, text) => {
    await renderApp(pathFor("collection", { id }), await unlocked());

    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "Delete this collection" }),
      );

    expect(screen.getByRole("alertdialog").textContent).toContain(text);
  });

  it("deletes the collection and every card in it once confirmed, and says so", async () => {
    const services = await unlocked();
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete this collection" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete collection",
      }),
    );

    const done = await screen.findByText(
      "The collection and its cards have been removed from this device.",
    );
    expect(done.closest("[role=status]")).not.toBeNull();
    expect(heading().textContent).toBe("Collection");
    await waitFor(() => {
      expect(document.activeElement).toBe(heading());
    });
    expect(screen.queryByText(/isn't on this device/)).toBeNull();
    expect(screen.queryByLabelText("Collection name")).toBeNull();
    expect(await services.cards.collection(SEED.sunday)).toBeUndefined();
    expect(
      (await services.records.list("conversation-card")).map((each) => each.id),
    ).toEqual([SEED.budget]);
  });

  it("says so if deleting fails, and the collection is still there", async () => {
    const services = await unlocked();
    services.records.delete = () => Promise.reject(new Error("synthetic"));
    await renderApp(pathFor("collection", SUNDAY), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete this collection" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete collection",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(NOT_SAVED);
    expect(heading().textContent).toBe("Sunday talk");
    expect(await cardTexts(services, SEED.sunday)).toHaveLength(3);
  });
});

describe("changing and deleting a card (CC-010)", () => {
  const OWN = { id: SEED.sunday, cardId: SEED.wondering };

  it("saves new words and a new kind, with no AI call", async () => {
    const provider = new FakeProvider();
    const services = { ...(await unlocked()), ai: new AiGateway(provider) };
    await renderApp(pathFor("card", OWN), services);
    const user = userEvent.setup();
    const box = await screen.findByLabelText(/What do you want to say/);
    expect(box).toHaveProperty(
      "value",
      "What would make weekday evenings easier for you?",
    );
    expect(screen.getByRole("radio", { name: "Curiosity" })).toHaveProperty(
      "checked",
      true,
    );

    await user.clear(box);
    await user.type(box, "Could we talk on Friday?");
    await user.click(screen.getByRole("radio", { name: "Need and request" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByRole("heading", { name: "Need and request" });
    expect(
      await services.cards.card(SEED.sunday, SEED.wondering),
    ).toMatchObject({ type: "need_request", authorship: "user_owned" });
    expect(await cardTexts(services, SEED.sunday)).toContain(
      "Could we talk on Friday?",
    );
    expect(provider.calls).toEqual([]);
  });

  it("refuses empty words and keeps the card as it was", async () => {
    const services = await unlocked();
    await renderApp(pathFor("card", OWN), services);
    const user = userEvent.setup();

    await user.clear(await screen.findByLabelText(/What do you want to say/));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      TEXT_NEEDED,
    );
    expect(await cardTexts(services, SEED.sunday)).toContain(
      "What would make weekday evenings easier for you?",
    );
  });

  it("offers no way to change a card that AI drafted and the person has not taken over", async () => {
    await renderApp(
      pathFor("card", { id: SEED.sunday, cardId: SEED.thanks }),
      await unlocked(),
    );

    await screen.findByText(/Drafted by AI/);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete this card" }),
    ).toBeNull();
  });

  it("asks before deleting a card, and cancelling keeps it", async () => {
    const services = await unlocked();
    await renderApp(pathFor("card", OWN), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete this card" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(DELETE_WARNING);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(
      await services.cards.card(SEED.sunday, SEED.wondering),
    ).toBeDefined();
  });

  it("deletes the card once confirmed, says so, and the collection no longer lists it", async () => {
    const services = await unlocked();
    await renderApp(pathFor("card", OWN), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete this card" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete card",
      }),
    );

    await screen.findByText("The card has been removed from this device.");
    await waitFor(() => {
      expect(document.activeElement).toBe(heading());
    });
    expect(screen.queryByText(/isn't on this device/)).toBeNull();
    expect((await services.cards.collection(SEED.sunday))?.cardIds).toEqual([
      SEED.thanks,
      SEED.chores,
    ]);

    await user.click(
      screen.getByRole("link", { name: "Back to the collection" }),
    );
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
  });

  it("shows the newer words when the card is changed elsewhere while open", async () => {
    const services = await unlocked();
    await renderApp(pathFor("card", OWN), services);
    await screen.findByLabelText(/What do you want to say/);
    const card = await services.cards.card(SEED.sunday, SEED.wondering);

    // As sync would.
    await services.records.put("conversation-card", {
      ...(card as NonNullable<typeof card>),
      segments: [{ id: "s", category: "other", text: "Changed on my phone." }],
      updatedAt: "2026-11-22T10:00:00.000Z",
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/What do you want to say/)).toHaveProperty(
        "value",
        "Changed on my phone.",
      );
    });
  });
});

describe("cards that belong to no collection (CC-010)", () => {
  async function withStray(): Promise<TestServices> {
    const services = await unlocked();
    await services.records.put("conversation-card", {
      id: "stray-1",
      collectionId: "gone",
      type: "other",
      authorship: "user_owned",
      segments: [{ id: "s", category: "other", text: "Written just in time." }],
      sourceEntryIds: [],
      createdAt: "2026-11-12T09:00:00.000Z",
      updatedAt: "2026-11-12T09:00:00.000Z",
    });
    return services;
  }

  it("says nothing about them when there are none", async () => {
    await renderApp("/prepare", await unlocked());
    await screen.findByRole("navigation", { name: "Your collections" });

    expect(screen.queryByText(/not in any collection/)).toBeNull();
  });

  it("shows them with what happened, and changes nothing until asked", async () => {
    const services = await withStray();
    await renderApp("/prepare", services);

    const section = (
      await screen.findByRole("heading", {
        name: "1 card is not in any collection",
      })
    ).closest(".card") as HTMLElement;

    expect(within(section).getByText(STRAYS_EXPLAINED)).toBeTruthy();
    expect(within(section).getByText("Written just in time.")).toBeTruthy();
    expect(await services.cards.strays()).toHaveLength(1);
  });

  it("keeps them in a collection of kept cards when asked", async () => {
    const services = await withStray();
    await renderApp("/prepare", services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: 'Keep them in "Kept cards"' }),
    );

    await screen.findByText('Kept in a collection called "Kept cards".');
    expect(screen.queryByText(/not in any collection/)).toBeNull();
    expect(
      within(
        screen.getByRole("navigation", { name: "Your collections" }),
      ).getByRole("link", { name: /Kept cards/ }).textContent,
    ).toBe("Kept cards0 cards");
    const kept = (await services.cards.collections()).find(
      (each) => each.name === "Kept cards",
    );
    expect(await cardTexts(services, kept?.id ?? "")).toEqual([
      "Written just in time.",
    ]);
  });

  it("deletes them only after a confirmation, and cancelling keeps them", async () => {
    const services = await withStray();
    await renderApp("/prepare", services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete them" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(DELETE_WARNING);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await services.cards.strays()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Delete them" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete cards",
      }),
    );

    await screen.findByText("Those cards were deleted.");
    expect(await services.cards.strays()).toEqual([]);
    expect(await services.records.list("conversation-card")).toHaveLength(4);
  });

  it("counts more than one, and says so if keeping fails", async () => {
    const services = await withStray();
    const first = await services.records.get("conversation-card", "stray-1");
    await services.records.put("conversation-card", {
      ...(first as NonNullable<typeof first>),
      id: "stray-2",
    });
    await renderApp("/prepare", services);
    await screen.findByRole("heading", {
      name: "2 cards are not in any collection",
    });
    services.records.put = () => Promise.reject(new Error("synthetic"));

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: 'Keep them in "Kept cards"' }));

    expect((await screen.findByRole("alert")).textContent).toContain(NOT_SAVED);
    expect(await services.cards.strays()).toHaveLength(2);
  });
});
