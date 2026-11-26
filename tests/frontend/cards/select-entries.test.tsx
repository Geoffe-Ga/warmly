/**
 * The screen where entries are picked and cards are asked for (PRD CC-001
 * to CC-004, AI-014, AI-015; AC-10, AC-15, AC-26).
 */
import { cleanup, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import type { AIProvider } from "../../../src/ai/provider";
import { pathFor } from "../../../src/app/routes";
import { createCollection } from "../../../src/domain/cards/collections";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  CARDS_NOT_SAVED,
  COLLECTION_GONE,
  NO_ENTRIES,
  SUGGEST_LEAD,
  TOO_MANY_TICKED,
  addedText,
} from "../../../src/ui/screens/prepare/SelectEntries";
import {
  renderApp,
  testServices,
  visit,
  type TestServices,
} from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

function entry(n: number, good: string): JournalEntry {
  return {
    id: `00000000-0000-4000-8000-0000000000d${String(n)}`,
    createdAt: `2026-11-0${String(n)}T10:00:00.000Z`,
    entryDate: { date: `2026-11-0${String(n)}`, timeZone: "UTC" },
    updatedAt: `2026-11-0${String(n)}T10:00:00.000Z`,
    status: "complete",
    responses: { good, improve: "Listen more.", loved: "A note in my bag." },
    contentHash: String(n).repeat(64),
  };
}

const ALPHA = entry(1, "Alpha: we cooked dinner together.");
const BRAVO = entry(2, "Bravo: a quiet walk by the river.");
const CHARLIE = entry(3, "Charlie: we argued about money.");
const SEND = "Send to Test provider";

async function setUp(
  provider: AIProvider = new FakeProvider(),
  entries: readonly JournalEntry[] = [ALPHA, BRAVO, CHARLIE],
): Promise<{ services: TestServices; collectionId: string; path: string }> {
  const services: TestServices = {
    ...testServices("unlocked"),
    ai: new AiGateway(provider),
  };
  for (const each of entries) {
    await services.records.put("journal-entry", each);
  }
  const collection = await createCollection(
    { records: services.records },
    "Sunday talk",
  );
  return {
    services,
    collectionId: collection.id,
    path: pathFor("suggest-cards", { id: collection.id }),
  };
}

function box(name: RegExp): HTMLInputElement {
  return screen.getByRole("checkbox", { name }) as HTMLInputElement;
}

async function tick(...names: RegExp[]): Promise<void> {
  const user = userEvent.setup();
  for (const name of names) {
    await user.click(await screen.findByRole("checkbox", { name }));
  }
}

async function press(name: string): Promise<void> {
  await userEvent.setup().click(await screen.findByRole("button", { name }));
}

async function cardsIn(
  services: TestServices,
  collectionId: string,
): Promise<number> {
  return (await services.cards.cards(collectionId)).length;
}

describe("picking entries (CC-001)", () => {
  it("is reached from the collection, by a link that sends nothing", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    await renderApp(pathFor("collection", { id: collectionId }), services);

    const link = await screen.findByRole("link", {
      name: "Pick entries and suggest cards",
    });

    expect(link.getAttribute("href")).toBe(path);
    expect(provider.calls).toEqual([]);
  });

  it("starts with nothing ticked, newest first, and offers no way to tick everything", async () => {
    const provider = new FakeProvider();
    const { services, path } = await setUp(provider);
    await renderApp(path, services);

    const boxes = (await screen.findAllByRole(
      "checkbox",
    )) as HTMLInputElement[];
    expect(boxes.map((each) => each.checked)).toEqual([false, false, false]);
    expect(boxes.map((each) => each.value)).toEqual([
      CHARLIE.id,
      BRAVO.id,
      ALPHA.id,
    ]);
    expect(screen.getByText(SUGGEST_LEAD)).toBeTruthy();
    expect(screen.getByText("0 entries ticked.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /all|recent|suggested/i }),
    ).toBeNull();
    // Opening the screen asked nothing of the provider.
    expect(provider.calls).toEqual([]);
  });

  it("keeps the button unavailable until an entry is ticked", async () => {
    const provider = new FakeProvider();
    const { services, path } = await setUp(provider);
    await renderApp(path, services);
    const button = await screen.findByRole("button", { name: "Suggest cards" });

    expect(button.getAttribute("aria-disabled")).toBe("true");
    await userEvent.setup().click(button);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await tick(/Alpha/);

    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByText("1 entry ticked.")).toBeTruthy();
    // Ticking sent nothing either.
    expect(provider.calls).toEqual([]);
  });

  it("names each entry by its day and how it starts, and shortens a long one", async () => {
    const long = entry(4, `Delta ${"word ".repeat(40)}`);
    const { services, path } = await setUp(new FakeProvider(), [long]);
    await renderApp(path, services);

    const label = (await screen.findByRole("checkbox")).closest("label");

    expect(label?.textContent).toMatch(/^November 4, 2026: Delta word /);
    expect(label?.textContent?.endsWith("…")).toBe(true);
    expect(label?.textContent?.length).toBeLessThan(110);
  });

  it("says so when there is no finished entry, and offers nothing to send", async () => {
    const { services, path } = await setUp(new FakeProvider(), [
      { ...ALPHA, status: "draft" },
    ]);
    await renderApp(path, services);

    expect(await screen.findByText(NO_ENTRIES)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suggest cards" })).toBeNull();
  });

  it("says so when the collection is not here", async () => {
    const { services } = await setUp();
    await renderApp(
      pathFor("suggest-cards", { id: "00000000-0000-4000-8000-00000000dead" }),
      services,
    );

    expect(await screen.findByText(/isn't on this device/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("asking for cards (CC-002, AC-10, AC-15)", () => {
  it("says exactly what will be sent, and Don't send keeps the ticks and sends nothing", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    await renderApp(path, services);
    await tick(/Alpha/, /Charlie/);

    await press("Suggest cards");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "This sends 2 journal entries to Test provider",
    );
    expect(dialog.textContent).not.toContain("your topic");
    await press("Don't send");

    expect(provider.calls).toEqual([]);
    expect(box(/Alpha/).checked).toBe(true);
    expect(box(/Charlie/).checked).toBe(true);
    expect(await cardsIn(services, collectionId)).toBe(0);
  });

  it("sends only the ticked entries, and adds the cards that come back to the collection", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    await renderApp(path, services);
    await tick(/Alpha/, /Charlie/);

    await press("Suggest cards");
    await press(SEND);

    expect(await screen.findByText(addedText(2))).toBeTruthy();
    expect(provider.calls).toHaveLength(1);
    const sent = JSON.stringify(provider.calls);
    expect(sent).toContain(ALPHA.responses.good);
    expect(sent).toContain(CHARLIE.responses.good);
    expect(sent).not.toContain(BRAVO.responses.good);
    const cards = await services.cards.cards(collectionId);
    expect(cards.map((card) => card.authorship)).toEqual([
      "ai_generated",
      "ai_generated",
    ]);
    expect(cards[0]?.sources?.map((source) => source.entryId)).toEqual([
      ALPHA.id,
      CHARLIE.id,
    ]);
    // The ticks are cleared, so nothing is sent twice by accident.
    expect(box(/Alpha/).checked).toBe(false);
  });

  it("shows the new cards in the collection, marked as drafted by AI", async () => {
    const { services, collectionId, path } = await setUp();
    await renderApp(path, services);
    await tick(/Bravo/);
    await press("Suggest cards");
    await press(SEND);
    await screen.findByText(addedText(1));

    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Back to the collection" }));

    const list = await screen.findByRole("navigation", {
      name: "Cards in this collection",
    });
    expect(within(list).getByRole("link").textContent).toBe(
      "A test card.Appreciation. Drafted by AI",
    );
    expect(await cardsIn(services, collectionId)).toBe(1);
  });

  it("changes nothing when the request fails, and tries again only when asked", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    await renderApp(path, services);
    await tick(/Alpha/);
    provider.failNextWith("network");

    await press("Suggest cards");
    await press(SEND);

    await screen.findByText(/Warmly does not try again by itself/);
    expect(provider.calls).toHaveLength(1);
    expect(box(/Alpha/).checked).toBe(true);
    expect(await cardsIn(services, collectionId)).toBe(0);

    // Try again asks first, every time.
    await press("Try again");
    expect(provider.calls).toHaveLength(1);
    await press(SEND);

    expect(await screen.findByText(addedText(1))).toBeTruthy();
    expect(provider.calls).toHaveLength(2);
  });

  // One card quoting words its entry does not hold refuses them all (PRD
  // AC-26).
  it("refuses the whole answer when one card is not grounded, and adds none of it", async () => {
    const base = new FakeProvider();
    const provider: AIProvider = {
      id: base.id,
      name: base.name,
      capabilities: () => base.capabilities(),
      validateConfig: () => base.validateConfig(),
      estimateTokens: (prompt) => base.estimateTokens(prompt),
      reflect: (prompt, signal) => base.reflect(prompt, signal),
      generateSegmentAlternatives: (prompt, signal) =>
        base.generateSegmentAlternatives(prompt, signal),
      generateCards: async (prompt, signal) => {
        const good = (await base.generateCards(prompt, signal)) as {
          cards: unknown[];
        };
        return {
          cards: [
            ...good.cards,
            {
              type: "other",
              theme: "Made up",
              segments: [
                {
                  category: "observation",
                  text: "You never listen.",
                  evidenceKind: "explicit",
                  teachingExplanation: "None.",
                  evidence: [
                    { alias: "E1", key: "good", quote: "words not in it" },
                  ],
                },
              ],
            },
          ],
        };
      },
    };
    const { services, collectionId, path } = await setUp(provider);
    await renderApp(path, services);
    await tick(/Alpha/);

    await press("Suggest cards");
    await press(SEND);

    await screen.findByText(/Warmly does not try again by itself/);
    expect(await cardsIn(services, collectionId)).toBe(0);
    expect(document.body.textContent).not.toContain("You never listen.");
  });

  it("asks for fewer entries when the ticked ones do not fit, and sends nothing", async () => {
    const base = new FakeProvider();
    const small: AIProvider = {
      id: base.id,
      name: base.name,
      // Room for entries: (3,000 - 1,500 - 1,000) less the margin = 425,
      // which holds two entries of 200 and not three.
      capabilities: () => ({ ...base.capabilities(), maxInputTokens: 3_000 }),
      validateConfig: () => base.validateConfig(),
      estimateTokens: (prompt) =>
        "sources" in prompt ? prompt.sources.length * 200 : 0,
      reflect: (prompt, signal) => base.reflect(prompt, signal),
      generateCards: (prompt, signal) => base.generateCards(prompt, signal),
      generateSegmentAlternatives: (prompt, signal) =>
        base.generateSegmentAlternatives(prompt, signal),
    };
    const { services, path } = await setUp(small);
    await renderApp(path, services);
    await tick(/Alpha/, /Bravo/, /Charlie/);

    await press("Suggest cards");

    expect(await screen.findByText(TOO_MANY_TICKED)).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(base.calls).toEqual([]);
    // The ticks are the person's: none was cleared for them.
    expect(box(/Alpha/).checked).toBe(true);
    expect(box(/Bravo/).checked).toBe(true);
    expect(box(/Charlie/).checked).toBe(true);

    // With fewer ticked, the same request can be made.
    await tick(/Charlie/);
    await press("Suggest cards");
    expect((await screen.findByRole("alertdialog")).textContent).toContain(
      "This sends 2 journal entries to Test provider",
    );
  });
});

describe("cards that have arrived are never dropped", () => {
  it("stay on the page with a way to save them when storing fails, and nothing is sent again", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    const put = services.records.put.bind(services.records);
    let failing = true;
    services.records.put = (kind, record) =>
      failing && kind === "conversation-card"
        ? Promise.reject(new Error("synthetic storage failure"))
        : put(kind, record);
    await renderApp(path, services);
    await tick(/Alpha/);
    await press("Suggest cards");
    await press(SEND);

    expect(await screen.findByText(CARDS_NOT_SAVED)).toBeTruthy();
    expect(document.body.textContent).not.toContain("synthetic storage");
    expect(await cardsIn(services, collectionId)).toBe(0);

    failing = false;
    await press("Save the cards");

    expect(await screen.findByText(addedText(1))).toBeTruthy();
    expect(await cardsIn(services, collectionId)).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("are saved when the person leaves the page after a save that failed", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    const put = services.records.put.bind(services.records);
    let failing = true;
    services.records.put = (kind, record) =>
      failing && kind === "conversation-card"
        ? Promise.reject(new Error("synthetic storage failure"))
        : put(kind, record);
    await renderApp(path, services);
    await tick(/Alpha/);
    await press("Suggest cards");
    await press(SEND);
    expect((await screen.findByText(CARDS_NOT_SAVED)).textContent).toContain(
      "Warmly will try once more if you leave this page",
    );

    // Storage works again, and the person leaves without pressing Save.
    failing = false;
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Back to the collection" }));

    const list = await screen.findByRole("navigation", {
      name: "Cards in this collection",
    });
    expect(within(list).getAllByRole("link")).toHaveLength(1);
    expect(await cardsIn(services, collectionId)).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("are saved before the keys go when the app locks first", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    const put = services.records.put.bind(services.records);
    let failing = true;
    services.records.put = (kind, record) =>
      failing && kind === "conversation-card"
        ? Promise.reject(new Error("synthetic storage failure"))
        : put(kind, record);
    await renderApp(path, services);
    await tick(/Alpha/);
    await press("Suggest cards");
    await press(SEND);
    await screen.findByText(CARDS_NOT_SAVED);

    failing = false;
    await services.lockHooks.flush();

    expect(await cardsIn(services, collectionId)).toBe(1);
  });

  it("are fully stored, once, by the time a lock that arrives mid-save lets go", async () => {
    const provider = new FakeProvider();
    const { services, collectionId, path } = await setUp(provider);
    const put = services.records.put.bind(services.records);
    const puts: string[] = [];
    let locked: Promise<number> | undefined;
    let listedAtLock = -1;
    services.records.put = (kind, record) => {
      puts.push(kind);
      // Storage takes real time, as IndexedDB does: the list is written a
      // little after it is asked for.
      const stored =
        kind === "card-collection"
          ? new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
              put(kind, record),
            )
          : put(kind, record);
      if (kind === "conversation-card" && locked === undefined) {
        // The lock arrives the instant the first card is stored, while
        // the collection's list has not been written yet.
        void stored.then(() => {
          locked = services.lockHooks.flush().then(async (failed) => {
            listedAtLock =
              (await services.records.get("card-collection", collectionId))
                ?.cardIds.length ?? -1;
            return failed;
          });
        });
      }
      return stored;
    };
    await renderApp(path, services);
    await tick(/Alpha/, /Charlie/);
    await press("Suggest cards");
    await press(SEND);
    await screen.findByText(addedText(2));

    // The lock waited for the save that was under way: no hook failed,
    // and both cards were in the collection before the keys could go.
    expect(await locked).toBe(0);
    expect(listedAtLock).toBe(2);
    // Each card was written once, and the list once.
    expect(puts).toEqual([
      "conversation-card",
      "conversation-card",
      "card-collection",
    ]);
  });

  it("are kept, and the person is told where, when their collection was deleted while they were on their way", async () => {
    const base = new FakeProvider();
    // What happens elsewhere just as the answer arrives; set below.
    const elsewhere = { run: (): Promise<void> => Promise.resolve() };
    const provider: AIProvider = {
      id: base.id,
      name: base.name,
      capabilities: () => base.capabilities(),
      validateConfig: () => base.validateConfig(),
      estimateTokens: (prompt) => base.estimateTokens(prompt),
      reflect: (prompt, signal) => base.reflect(prompt, signal),
      generateSegmentAlternatives: (prompt, signal) =>
        base.generateSegmentAlternatives(prompt, signal),
      generateCards: async (prompt, signal) => {
        const answer = await base.generateCards(prompt, signal);
        // Deleted on another device while the request was on its way.
        await elsewhere.run();
        return answer;
      },
    };
    const { services, collectionId, path } = await setUp(provider);
    elsewhere.run = () =>
      services.records.delete("card-collection", collectionId);
    await renderApp(path, services);
    await tick(/Alpha/);
    await press("Suggest cards");
    await press(SEND);

    expect(await screen.findByText(COLLECTION_GONE)).toBeTruthy();
    expect(await services.cards.strays()).toHaveLength(1);
    // Nothing more can be asked for a collection that has gone.
    expect(
      screen
        .getByRole("button", { name: "Suggest cards" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
