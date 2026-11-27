/**
 * Learning mode and conversation mode for a card AI drafted (PRD CC-004,
 * CC-005, CC-006, DEP-004; AC-11, AC-23, AC-26).
 */
import { cleanup, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { pathFor } from "../../../src/app/routes";
import { excerptFor, provenanceOf } from "../../../src/domain/cards/provenance";
import type { ConversationCard } from "../../../src/domain/cards/types";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  INFERRED,
  JOURNAL_LOADING,
  JOURNAL_NOT_OPEN,
  I_STATEMENT_CAVEAT,
  MORE_OPTIONS_HINT,
  OWN_WORDS,
  SUGGESTED,
  UNRESOLVED,
} from "../../../src/ui/components/SegmentDetail";
import { LEARNING_LEAD } from "../../../src/ui/screens/prepare/CardScreen";
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

const ENTRY: JournalEntry = {
  id: "00000000-0000-4000-8000-0000000000e1",
  createdAt: "2026-11-03T10:00:00.000Z",
  entryDate: { date: "2026-11-03", timeZone: "UTC" },
  updatedAt: "2026-11-03T10:00:00.000Z",
  status: "complete",
  responses: {
    good: "We cooked dinner together on Sunday.",
    improve: "I need more notice before plans change.",
    loved: "They left a note in my bag.",
  },
  contentHash: "e".repeat(64),
};
const COLLECTION = "00000000-0000-4000-8000-0000000000c0";
const MADE = "2026-11-04T09:00:00.000Z";

function ref(key: "good" | "improve" | "loved", quote: string) {
  const start = ENTRY.responses[key].indexOf(quote);
  return {
    entryId: ENTRY.id,
    responseKey: key,
    start,
    end: start + quote.length,
    sourceHash: ENTRY.contentHash,
  };
}

const CARD: ConversationCard = {
  id: "00000000-0000-4000-8000-0000000000a1",
  collectionId: COLLECTION,
  type: "need_request",
  authorship: "ai_generated",
  segments: [
    {
      id: "s1",
      category: "appreciation",
      text: "I loved cooking with you.",
      evidenceKind: "explicit",
      teachingExplanation: "Naming one moment is easier to hear.",
      evidence: [ref("good", "cooked dinner together")],
    },
    {
      id: "s2",
      category: "need",
      text: "I need more notice.",
      evidenceKind: "inference",
      teachingExplanation: "A need is easier to meet than a complaint.",
      evidence: [],
    },
    {
      id: "s3",
      category: "request",
      text: "Could we check plans on Thursdays?",
      evidenceKind: "suggestion",
      teachingExplanation: "A request can be answered.",
      evidence: [],
    },
    {
      id: "s4",
      category: "observation",
      text: "Plans changed twice last week.",
      evidenceKind: "paraphrase",
      teachingExplanation: "An observation leaves out blame.",
      evidence: [
        ref("improve", "more notice before plans change"),
        ref("loved", "a note in my bag"),
      ],
    },
  ],
  sourceEntryIds: [ENTRY.id],
  sources: [{ entryId: ENTRY.id, sourceHash: ENTRY.contentHash }],
  createdAt: MADE,
  updatedAt: MADE,
};
const PATH = pathFor("card", { id: COLLECTION, cardId: CARD.id });

async function setUp(
  entry: JournalEntry | "none" = ENTRY,
): Promise<{ services: TestServices; provider: FakeProvider }> {
  const provider = new FakeProvider();
  const services: TestServices = {
    ...testServices("unlocked"),
    ai: new AiGateway(provider),
  };
  if (entry !== "none") {
    await services.records.put("journal-entry", entry);
  }
  await services.records.put("conversation-card", CARD);
  await services.records.put("card-collection", {
    id: COLLECTION,
    name: "Sunday talk",
    cardIds: [CARD.id],
    createdAt: MADE,
    updatedAt: MADE,
  });
  // The invalidator is not started here, so a card whose entry has
  // changed stays on screen long enough to be looked at.
  return { services, provider };
}

async function learning(): Promise<void> {
  await userEvent
    .setup()
    .click(await screen.findByRole("radio", { name: /^Learning/ }));
}

async function openPart(name: RegExp): Promise<HTMLElement> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
  return screen.findByRole("region", { name: "About this part" });
}

// What a part cites is read from the entry as it is now, or it is not
// shown at all (PRD AC-26).
describe("where a part comes from, worked out now (CC-004, DEP-004)", () => {
  it("reads the words from the entry as it is", () => {
    expect(excerptFor(ref("good", "cooked dinner together"), [ENTRY])).toEqual({
      entryId: ENTRY.id,
      entryDate: ENTRY.entryDate,
      prompt: "What's going well?",
      text: "cooked dinner together",
    });
  });

  it.each([
    ["the entry is not here", []],
    [
      "the entry has changed since",
      [{ ...ENTRY, contentHash: "f".repeat(64) }],
    ],
    ["the entry is a draft", [{ ...ENTRY, status: "draft" as const }]],
  ])("shows nothing when %s", (_why, entries) => {
    expect(
      excerptFor(ref("good", "cooked dinner together"), entries),
    ).toBeUndefined();
  });

  it.each([
    ["starts before the answer", { start: -1, end: 4 }],
    ["is empty", { start: 4, end: 4 }],
    ["runs past the end", { start: 0, end: 500 }],
  ])("shows nothing when the range %s", (_why, range) => {
    expect(
      excerptFor({ ...ref("good", "cooked"), ...range }, [ENTRY]),
    ).toBeUndefined();
  });

  it("shows nothing for an answer name a journal entry does not have", () => {
    expect(
      excerptFor({ ...ref("good", "cooked"), responseKey: "went_well" }, [
        ENTRY,
      ]),
    ).toBeUndefined();
  });

  it("never shows half of an emoji at either end of the words", () => {
    const entry: JournalEntry = {
      ...ENTRY,
      responses: { ...ENTRY.responses, good: "Dinner 🍝 was lovely 🌙" },
    };
    const text = entry.responses.good;
    const cut = (start: number, end: number) =>
      excerptFor(
        {
          entryId: entry.id,
          responseKey: "good",
          start,
          end,
          sourceHash: entry.contentHash,
        },
        [entry],
      )?.text;

    // The range starts in the middle of the first emoji and ends in the
    // middle of the second: the halves are left out.
    expect(cut(text.indexOf("🍝") + 1, text.indexOf("🌙") + 1)).toBe(
      " was lovely ",
    );
    // A range that holds whole emoji keeps them.
    expect(cut(text.indexOf("🍝"), text.length)).toBe("🍝 was lovely 🌙");
    // Nothing but half an emoji is nothing to show.
    expect(cut(text.indexOf("🍝") + 1, text.indexOf("🍝") + 2)).toBeUndefined();
  });

  it("sorts each kind of part", () => {
    const [explicit, inferred, suggested, paraphrase] = CARD.segments;
    const kindOf = (segment: (typeof CARD.segments)[number] | undefined) =>
      segment === undefined ? undefined : provenanceOf(segment, [ENTRY]).kind;

    expect(kindOf(explicit)).toBe("quoted");
    expect(kindOf(inferred)).toBe("inferred");
    expect(kindOf(suggested)).toBe("suggested");
    expect(kindOf(paraphrase)).toBe("quoted");
    expect(
      provenanceOf({ id: "x", category: "other", text: "Mine." }, [ENTRY]),
    ).toEqual({ kind: "own" });
  });

  it("keeps the words it can still show when only some can be", () => {
    const [, , , paraphrase] = CARD.segments;
    const changed = {
      ...paraphrase,
      evidence: [
        ref("improve", "more notice"),
        { ...ref("loved", "a note"), sourceHash: "f".repeat(64) },
      ],
    } as (typeof CARD.segments)[number];

    const found = provenanceOf(changed, [ENTRY]);

    expect(
      found.kind === "quoted" && found.excerpts.map((e) => e.text),
    ).toEqual(["more notice"]);
  });

  it("says a quoted part cannot be shown when none of its words can", () => {
    const [explicit] = CARD.segments;

    expect(explicit && provenanceOf(explicit, [])).toEqual({
      kind: "unresolved",
    });
  });
});

describe("conversation mode (CC-006)", () => {
  it("comes first, and shows the card's words with no parts, labels or explanations", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);

    expect(
      await screen.findByText(
        "I loved cooking with you. I need more notice. Could we check plans on Thursdays? Plans changed twice last week.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("radio", { name: /^Conversation/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      screen.queryByRole("list", { name: "The parts of this card" }),
    ).toBeNull();
    expect(screen.queryByText(/easier to hear/)).toBeNull();
    expect(screen.queryByText(LEARNING_LEAD)).toBeNull();
    expect(document.body.textContent).not.toContain(ENTRY.responses.good);
  });

  it("is what a card the person wrote always shows: there is no mode to pick", async () => {
    const { services } = await setUp();
    await services.records.put("conversation-card", {
      ...CARD,
      authorship: "user_owned",
      segments: [{ id: "s1", category: "other", text: "Mine." }],
    });
    await renderApp(PATH, services);

    await screen.findByText("Written by you.");
    expect(screen.queryByRole("radio", { name: /^Learning/ })).toBeNull();
  });
});

describe("learning mode (CC-005, AC-11)", () => {
  it("makes each part a button that names its kind in words", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();

    const parts = screen.getByRole("list", { name: "The parts of this card" });
    const buttons = within(parts).getAllByRole("button");

    expect(buttons.map((button) => button.textContent)).toEqual([
      "Appreciation I loved cooking with you.",
      "Need I need more notice.",
      "Request Could we check plans on Thursdays?",
      "Observation Plans changed twice last week.",
    ]);
    for (const button of buttons) {
      expect(button.getAttribute("aria-expanded")).toBe("false");
    }
    // The kind is written out on the button, not told by colour.
    expect(
      buttons.map((button) => button.firstElementChild?.textContent),
    ).toEqual(["Appreciation", "Need", "Request", "Observation"]);
    expect(screen.getByText(LEARNING_LEAD)).toBeTruthy();
  });

  it("shows the person's own words for a part that rests on them, with a way to the entry", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();

    const panel = within(await openPart(/appreciation i loved cooking/i));

    expect(panel.getByTestId("source-excerpt").textContent).toBe(
      "cooked dinner together",
    );
    expect(
      panel
        .getByRole("link", { name: /your entry from November 3, 2026/ })
        .getAttribute("href"),
    ).toBe(pathFor("journal-entry", { id: ENTRY.id }));
    expect(panel.getByText(/under “What's going well\?”/)).toBeTruthy();
    expect(
      panel.getByText("Naming one moment is easier to hear."),
    ).toBeTruthy();
  });

  it("shows every source of a part that rests on more than one", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();

    const panel = within(await openPart(/observation plans changed/i));

    expect(
      panel.getAllByTestId("source-excerpt").map((each) => each.textContent),
    ).toEqual(["more notice before plans change", "a note in my bag"]);
  });

  // What the AI inferred is labelled as inferred, not as a quote (PRD AC-26).
  it("labels an inferred segment instead of showing a source (AC-11)", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();

    await openPart(/need i need more notice/i);

    expect(screen.getByText(/inferred from your writing/i)).toBeTruthy();
    expect(screen.getByText(INFERRED)).toBeTruthy();
    expect(screen.queryByTestId("source-excerpt")).toBeNull();
  });

  it("labels a suggested segment as the AI's own addition", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();

    await openPart(/request could we check/i);

    expect(screen.getByText(SUGGESTED)).toBeTruthy();
    expect(screen.queryByTestId("source-excerpt")).toBeNull();
  });

  it("shows no words, and says why, while the entry is changed in two places and not yet settled", async () => {
    // A card whose entry has simply changed is removed (invariant 6). One
    // whose entry is waiting for the person to choose a version stays, and
    // must not show words from either version.
    const changed = {
      ...ENTRY,
      responses: { ...ENTRY.responses, good: "We ordered pizza on Sunday." },
      contentHash: "f".repeat(64),
    };
    const { services } = await setUp(changed);
    services.records.park(ENTRY.id, ENTRY, 2, "journal-entry");
    await renderApp(PATH, services);
    await learning();

    await openPart(/appreciation i loved cooking/i);

    expect(screen.getByText(UNRESOLVED)).toBeTruthy();
    expect(screen.queryByTestId("source-excerpt")).toBeNull();
    expect(document.body.textContent).not.toContain("cooked dinner");
    expect(document.body.textContent).not.toContain("ordered pizza");
  });

  it("shows no words when the entry is not on this device", async () => {
    const { services } = await setUp("none");
    await renderApp(PATH, services);
    await learning();

    await openPart(/appreciation i loved cooking/i);

    expect(screen.getByText(UNRESOLVED)).toBeTruthy();
  });

  it("does not say the entry is missing when the journal simply could not be opened", async () => {
    const { services } = await setUp();
    const list = services.records.list.bind(services.records);
    services.records.list = ((kind: string) =>
      kind === "journal-entry"
        ? Promise.reject(new Error("synthetic failure"))
        : list(kind as never)) as typeof services.records.list;
    await renderApp(PATH, services);
    await learning();

    await openPart(/appreciation i loved cooking/i);

    expect(screen.getByText(JOURNAL_NOT_OPEN)).toBeTruthy();
    expect(screen.queryByText(UNRESOLVED)).toBeNull();
    expect(screen.queryByTestId("source-excerpt")).toBeNull();
    expect(document.body.textContent).not.toContain("synthetic failure");
  });

  it("says it is still getting the journal, not that the entry is missing, while the journal loads", async () => {
    const { services } = await setUp();
    const list = services.records.list.bind(services.records);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderApp(PATH, services);
    // From here on the journal takes a while to come back.
    services.records.list = ((kind: string) =>
      kind === "journal-entry"
        ? held.then(() => list("journal-entry"))
        : list(kind as never)) as typeof services.records.list;
    await learning();

    await openPart(/appreciation i loved cooking/i);

    expect(screen.getByText(JOURNAL_LOADING)).toBeTruthy();
    expect(screen.queryByText(UNRESOLVED)).toBeNull();

    release();

    expect((await screen.findByTestId("source-excerpt")).textContent).toBe(
      "cooked dinner together",
    );
  });

  it("says what an I-statement is and is not, with every explanation", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();

    await openPart(/need i need more notice/i);

    expect(screen.getByText(I_STATEMENT_CAVEAT)).toBeTruthy();
    expect(I_STATEMENT_CAVEAT).toContain(
      "It does not make a claim about what happened true, or beyond question.",
    );
  });

  it("has fixed words for a part with no annotation", () => {
    expect(OWN_WORDS).toBe("These are your own words.");
  });

  it("opens one part at a time", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();

    await openPart(/need i need more notice/i);
    await openPart(/request could we check/i);

    expect(
      screen.getAllByRole("region", { name: "About this part" }),
    ).toHaveLength(1);
    expect(screen.queryByText(INFERRED)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /need i need more notice/i })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: /request could we check/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("calls no AI by switching mode or opening a part", async () => {
    const { services, provider } = await setUp();
    await renderApp(PATH, services);
    await learning();
    await openPart(/need i need more notice/i);

    expect(screen.getByText(MORE_OPTIONS_HINT)).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(provider.calls).toEqual([]);
  });

  it("goes back to the plain words when conversation mode is picked again", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();
    await openPart(/need i need more notice/i);

    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: /^Conversation/ }));

    expect(
      screen.queryByRole("list", { name: "The parts of this card" }),
    ).toBeNull();
    expect(screen.queryByText(INFERRED)).toBeNull();
  });
});

describe("the keyboard (AC-23)", () => {
  it("opens a part with Enter, moves focus into the panel, and gives it back on Escape", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();
    const user = userEvent.setup();
    const part = screen.getByRole("button", {
      name: /need i need more notice/i,
    });

    part.focus();
    await user.keyboard("{Enter}");

    const panel = await screen.findByRole("region", {
      name: "About this part",
    });
    expect(document.activeElement).toBe(
      within(panel).getByRole("heading", { name: "About this part" }),
    );

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("region", { name: "About this part" }),
    ).toBeNull();
    expect(document.activeElement).toBe(part);
  });

  it("opens with Space, and Close gives focus back to the part", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();
    const user = userEvent.setup();
    const part = screen.getByRole("button", {
      name: /request could we check/i,
    });

    part.focus();
    await user.keyboard(" ");
    await user.click(await screen.findByRole("button", { name: "Close" }));

    expect(
      screen.queryByRole("region", { name: "About this part" }),
    ).toBeNull();
    expect(document.activeElement).toBe(part);
  });

  it("closes when the open part is pressed again", async () => {
    const { services } = await setUp();
    await renderApp(PATH, services);
    await learning();
    await openPart(/need i need more notice/i);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /need i need more notice/i }));

    expect(
      screen.queryByRole("region", { name: "About this part" }),
    ).toBeNull();
  });
});
