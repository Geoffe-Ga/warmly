/**
 * Collections and cards on the "Changed in two places" screen (PRD
 * SYNC-004, SYNC-005; AC-16; invariant 5).
 */
import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readingText,
  type CardCollection,
  type ConversationCard,
} from "../../../src/domain/cards/types";
import type { ReflectSession } from "../../../src/domain/reflect/types";
import {
  ConflictChangedError,
  type RecordConflict,
} from "../../../src/storage/record-store";
import { KEPT_CARDS_NAME } from "../../../src/sync/card-conflicts";
import {
  CARD_ALREADY_SETTLED,
  CARD_CHANGED_AGAIN,
  CARD_CHOICE_FAILED,
} from "../../../src/ui/screens/sync/CardConflicts";
import { renderApp, testServices, visit, type TestServices } from "./helpers";
import { CARDS, COLLECTIONS, SEED, seedCards } from "./seed-cards";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

const PATH = "/sync/conflicts";
function needed<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("the invented cards are missing");
  }
  return value;
}

const MINE: ConversationCard = needed(CARDS[2]);
const SUNDAY: CardCollection = needed(COLLECTIONS[0]);
const THEIRS: ConversationCard = {
  ...MINE,
  type: "need_request",
  segments: [{ id: "s", category: "other", text: "From my phone." }],
};

async function seeded(): Promise<TestServices> {
  const services = testServices("unlocked");
  await seedCards(services.records);
  return services;
}

async function open(services: TestServices): Promise<void> {
  await renderApp(PATH, services);
}

function item(name: "A card" | "A collection"): HTMLElement {
  return screen.getByRole("region", { name });
}

async function press(name: string): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

async function sundayTexts(services: TestServices): Promise<string[]> {
  return (await services.cards.cards(SEED.sunday)).map(readingText);
}

describe("a card changed in two places", () => {
  it("shows both versions and removes neither until the person chooses", async () => {
    const services = await seeded();
    services.records.park(MINE.id, THEIRS, 2, "conversation-card");

    await open(services);

    const card = within(await screen.findByRole("region", { name: "A card" }));
    expect(card.getByText(/changed here and on another device/)).toBeTruthy();
    expect(
      within(
        card
          .getByRole("heading", { name: "On this device" })
          .closest(".card") as HTMLElement,
      ).getByText("What would make weekday evenings easier for you?"),
    ).toBeTruthy();
    expect(
      within(
        card
          .getByRole("heading", { name: "On your other device" })
          .closest(".card") as HTMLElement,
      ).getByText("From my phone."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Nothing is removed until you choose/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Warmly never merges or picks for you/),
    ).toBeTruthy();
    expect(await sundayTexts(services)).toContain(
      "What would make weekday evenings easier for you?",
    );
    expect(await services.records.conflicts("conversation-card")).toHaveLength(
      1,
    );
  });

  it("keeps the other version when asked, says so, and then nothing needs attention", async () => {
    const services = await seeded();
    services.records.park(MINE.id, THEIRS, 2, "conversation-card");
    await open(services);
    await screen.findByRole("region", { name: "A card" });

    await press("Keep the other version");

    await screen.findByText("The other device's version of the card was kept.");
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "A card" })).toBeNull();
    });
    expect(screen.getByText("Nothing needs your attention.")).toBeTruthy();
    expect(await sundayTexts(services)).toContain("From my phone.");
    expect(await sundayTexts(services)).not.toContain(
      "What would make weekday evenings easier for you?",
    );
  });

  it("keeps this device's version when asked", async () => {
    const services = await seeded();
    services.records.park(MINE.id, THEIRS, 2, "conversation-card");
    await open(services);
    await screen.findByRole("region", { name: "A card" });

    await press("Keep this device's version");

    await screen.findByText("This device's version of the card was kept.");
    expect(await sundayTexts(services)).not.toContain("From my phone.");
    expect(await services.records.conflicts("conversation-card")).toEqual([]);
  });

  it("is not listed among journal entries, and a journal conflict is not listed among cards", async () => {
    const services = await seeded();
    services.records.park(MINE.id, THEIRS, 2, "conversation-card");

    await open(services);
    await screen.findByRole("region", { name: "A card" });

    expect(screen.queryByRole("region", { name: /^Entry from/ })).toBeNull();
    expect(screen.getAllByRole("region", { name: /^A / })).toHaveLength(1);
  });
});

describe("a collection changed in two places", () => {
  it("shows both names and how many cards each lists, and says no card is lost either way", async () => {
    const services = await seeded();
    services.records.park(
      SUNDAY.id,
      { ...SUNDAY, name: "Weekend talk", cardIds: [SEED.thanks] },
      2,
      "card-collection",
    );

    await open(services);

    const region = within(
      await screen.findByRole("region", { name: "A collection" }),
    );
    expect(region.getByText("Sunday talk")).toBeTruthy();
    expect(region.getByText("3 cards listed")).toBeTruthy();
    expect(region.getByText("Weekend talk")).toBeTruthy();
    expect(region.getByText("1 card listed")).toBeTruthy();
    expect(region.getByText(/no card is lost/)).toBeTruthy();

    await press("Keep the other version");

    await screen.findByText(
      "The other device's version of the collection was kept.",
    );
    expect((await services.cards.collection(SEED.sunday))?.name).toBe(
      "Weekend talk",
    );
    // Every card is still there, though the kept list names one.
    expect(await sundayTexts(services)).toHaveLength(3);
  });
});

describe("changed here, deleted on the other device", () => {
  it("offers to keep the card as a new one or to discard it, and explains why it cannot simply be kept", async () => {
    const services = await seeded();
    services.records.park(MINE.id, undefined, 2, "conversation-card");
    await open(services);

    const region = within(
      await screen.findByRole("region", { name: "A card" }),
    );
    expect(region.getByText(/A deleted card does not come back/)).toBeTruthy();
    expect(
      region.queryByRole("heading", { name: "On your other device" }),
    ).toBeNull();
    expect(
      region.getAllByRole("button").map((each) => each.textContent),
    ).toEqual(["Keep mine as a new card", "Discard this version"]);
  });

  it("keeps the words as a new card in the same collection", async () => {
    const services = await seeded();
    services.records.park(MINE.id, undefined, 2, "conversation-card");
    await open(services);
    await screen.findByRole("region", { name: "A card" });

    await press("Keep mine as a new card");

    await screen.findByText("Your version was kept as a new card.");
    expect(
      await services.records.get("conversation-card", MINE.id),
    ).toBeUndefined();
    expect(await sundayTexts(services)).toContain(
      "What would make weekday evenings easier for you?",
    );
  });

  it("discards it when asked", async () => {
    const services = await seeded();
    services.records.park(MINE.id, undefined, 2, "conversation-card");
    await open(services);
    await screen.findByRole("region", { name: "A card" });

    await press("Discard this version");

    await screen.findByText("The card was deleted here too.");
    expect(await sundayTexts(services)).toHaveLength(2);
  });

  it("a kept card whose collection is gone goes into a collection of kept cards", async () => {
    const services = await seeded();
    await services.records.delete("card-collection", SEED.sunday);
    services.records.park(MINE.id, undefined, 2, "conversation-card");
    await open(services);
    expect(
      (await screen.findByRole("region", { name: "A card" })).textContent,
    ).toContain(`a collection called "${KEPT_CARDS_NAME}"`);

    await press("Keep mine as a new card");

    await screen.findByText("Your version was kept as a new card.");
    const kept = (await services.cards.collections()).find(
      (each) => each.name === KEPT_CARDS_NAME,
    );
    expect(
      (await services.cards.cards(kept?.id ?? "")).map(readingText),
    ).toEqual(["What would make weekday evenings easier for you?"]);
  });

  it("a collection can be kept as a new, empty one", async () => {
    const services = await seeded();
    services.records.park(SUNDAY.id, undefined, 2, "card-collection");
    await open(services);
    expect(
      (await screen.findByRole("region", { name: "A collection" })).textContent,
    ).toContain("which starts with no cards");

    await press("Keep mine as a new collection");

    await screen.findByText("Your version was kept as a new collection.");
    const named = (await services.cards.collections()).filter(
      (each) => each.name === "Sunday talk",
    );
    expect(named).toHaveLength(1);
    expect(named[0]?.id).not.toBe(SEED.sunday);
    expect(named[0]?.cardIds).toEqual([]);
  });
});

describe("deleted here, changed on the other device", () => {
  async function deletedHere(): Promise<TestServices> {
    const services = await seeded();
    await services.records.delete("conversation-card", MINE.id);
    services.records.park(MINE.id, THEIRS, 2, "conversation-card");
    return services;
  }

  it("shows the other device's version and both choices", async () => {
    await open(await deletedHere());

    const region = within(
      await screen.findByRole("region", { name: "A card" }),
    );
    expect(region.getByText(/You deleted this card here/)).toBeTruthy();
    expect(region.getByText("From my phone.")).toBeTruthy();
    expect(
      region.queryByRole("heading", { name: "On this device" }),
    ).toBeNull();
    expect(
      region.getAllByRole("button").map((each) => each.textContent),
    ).toEqual(["Keep the other version", "Delete it everywhere"]);
  });

  it("takes the deletion back when asked", async () => {
    const services = await deletedHere();
    await open(services);
    await screen.findByRole("region", { name: "A card" });

    await press("Keep the other version");

    await screen.findByText(
      "The deletion was taken back and the other device's version was kept.",
    );
    expect(await sundayTexts(services)).toContain("From my phone.");
  });

  it("deletes it everywhere when asked", async () => {
    const services = await deletedHere();
    await open(services);
    await screen.findByRole("region", { name: "A card" });

    await press("Delete it everywhere");

    await screen.findByText(
      "The card is deleted and will be deleted on your other devices.",
    );
    expect(await sundayTexts(services)).toHaveLength(2);
    expect(await services.records.conflicts("conversation-card")).toEqual([]);
  });
});

describe("when a choice cannot be stored", () => {
  it.each([
    [
      "the other version changed again",
      new ConflictChangedError(),
      CARD_CHANGED_AGAIN,
    ],
    [
      "something unexpected happened",
      new Error("synthetic CANARY"),
      CARD_CHOICE_FAILED,
    ],
  ])(
    "says so when %s, and changes nothing",
    async (_name, failure, message) => {
      const services = await seeded();
      services.records.park(MINE.id, THEIRS, 2, "conversation-card");
      services.records.resolve = () => Promise.reject(failure);
      await open(services);
      await screen.findByRole("region", { name: "A card" });

      await press("Keep the other version");

      expect(
        (await screen.findByText(message)).closest("[role=alert]"),
      ).not.toBeNull();
      expect(document.body.textContent).not.toContain("CANARY");
      expect(item("A card")).toBeTruthy();
      expect(await sundayTexts(services)).not.toContain("From my phone.");
    },
  );

  it("says so when it was already settled somewhere else", async () => {
    const services = await seeded();
    services.records.park(MINE.id, THEIRS, 2, "conversation-card");
    services.records.resolve = () => Promise.resolve(false);
    await open(services);
    await screen.findByRole("region", { name: "A card" });

    await press("Keep this device's version");

    await screen.findByText(CARD_ALREADY_SETTLED);
  });

  it("shows a newer other version when one arrives while the person is reading", async () => {
    const services = await seeded();
    services.records.park(MINE.id, THEIRS, 2, "conversation-card");
    await open(services);
    await screen.findByText("From my phone.");

    services.records.park(
      MINE.id,
      {
        ...THEIRS,
        segments: [{ id: "s", category: "other", text: "Newer still." }],
      },
      3,
      "conversation-card",
    );

    await screen.findByText("Newer still.");
    expect(screen.queryByText("From my phone.")).toBeNull();
  });

  it("says so if the cards cannot be read at all", async () => {
    const services = await seeded();
    const conflicts = services.records.conflicts.bind(services.records);
    services.records.conflicts = ((kind: "journal-entry") =>
      kind === "journal-entry"
        ? conflicts(kind)
        : Promise.reject(new Error("synthetic CANARY"))) as typeof conflicts;

    await open(services);

    const alert = await screen.findByText(/Couldn't open your cards/);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(document.body.textContent).not.toContain("CANARY");
  });
});

describe("a version this app cannot read", () => {
  it("says to update, offers no choice and removes nothing", async () => {
    const services = await seeded();
    const conflicts = services.records.conflicts.bind(services.records);
    const unreadable: RecordConflict<ConversationCard> = {
      id: MINE.id,
      mine: MINE,
      theirs: undefined,
      theirsDeleted: false,
      revision: 2,
    };
    services.records.conflicts = ((kind: string) =>
      kind === "conversation-card"
        ? Promise.resolve([unreadable])
        : conflicts(kind as "journal-entry")) as typeof conflicts;

    await open(services);

    const region = within(
      await screen.findByRole("region", { name: "A card" }),
    );
    expect(region.getByText(/newer version of Warmly/)).toBeTruthy();
    expect(region.queryAllByRole("button")).toEqual([]);
    expect(await sundayTexts(services)).toHaveLength(3);
  });
});

describe("a reflection changed in two places", () => {
  const SESSION: ReflectSession = {
    id: "5eed0000-0000-4000-8000-00000000f001",
    status: "active",
    messages: [
      {
        id: "q1",
        role: "question",
        text: "What has gone well?",
        at: "2026-11-20T09:00:00.000Z",
      },
      {
        id: "a1",
        role: "answer",
        at: "2026-11-20T09:00:00.000Z",
        answer: {
          markdown: "Plenty.",
          citations: [],
          sources: [],
          coverage: {
            includedEntryIds: [],
            omittedEntryCount: 0,
            truncated: false,
          },
        },
      },
    ],
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
  };
  const THEIR_SESSION: ReflectSession = {
    ...SESSION,
    status: "finished",
    messages: [
      ...SESSION.messages,
      {
        id: "q2",
        role: "question",
        text: "And then?",
        at: "2026-11-21T09:00:00.000Z",
      },
    ],
  };

  it("shows each version by its first question and how much it holds, and keeps the one chosen", async () => {
    const services = await seeded();
    await services.records.put("reflect-session", SESSION);
    services.records.park(SESSION.id, THEIR_SESSION, 2, "reflect-session");
    await open(services);

    const region = within(
      await screen.findByRole("region", { name: "A reflection" }),
    );
    expect(
      region.getByText(/added to, or finished, here and on another device/),
    ).toBeTruthy();
    expect(region.getAllByText("What has gone well?")).toHaveLength(2);
    expect(region.getByText("1 question")).toBeTruthy();
    expect(region.getByText("2 questions, finished")).toBeTruthy();

    await press("Keep the other version");

    await screen.findByText(
      "The other device's version of the reflection was kept.",
    );
    expect((await services.reflect.get(SESSION.id))?.status).toBe("finished");
  });

  it("one deleted elsewhere can be kept as a new reflection", async () => {
    const services = await seeded();
    await services.records.put("reflect-session", SESSION);
    services.records.park(SESSION.id, undefined, 2, "reflect-session");
    await open(services);
    expect(
      (await screen.findByRole("region", { name: "A reflection" })).textContent,
    ).toContain("with all of its questions and answers");

    await press("Keep mine as a new reflection");

    await screen.findByText("Your version was kept as a new reflection.");
    const [kept] = await services.reflect.list();
    expect(kept?.id).not.toBe(SESSION.id);
    expect(kept?.messages).toHaveLength(2);
  });
});
