/**
 * Changing a card on its screen: part by part or as one text, with the
 * first saved change making an AI card the person's own (PRD CC-006 to
 * CC-009; AC-12; decision D-15).
 */
import { cleanup, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { pathFor } from "../../../src/app/routes";
import {
  OWNERSHIP_NOTE,
  PARTS_HINT,
  STILL_HAS_NOTES,
} from "../../../src/ui/screens/prepare/CardScreen";
import {
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
});

const AI_CARD = pathFor("card", { id: SEED.sunday, cardId: SEED.thanks });
const OWN_CARD = pathFor("card", { id: SEED.sunday, cardId: SEED.chores });
const ONE_PART = pathFor("card", { id: SEED.sunday, cardId: SEED.wondering });

async function setUp(): Promise<{
  services: TestServices;
  provider: FakeProvider;
}> {
  const provider = new FakeProvider();
  const services: TestServices = {
    ...testServices("unlocked"),
    ai: new AiGateway(provider),
  };
  await seedCards(services.records);
  return { services, provider };
}

async function press(name: string): Promise<void> {
  await userEvent.setup().click(await screen.findByRole("button", { name }));
}

async function retype(label: RegExp, text: string): Promise<void> {
  const user = userEvent.setup();
  const box = await screen.findByLabelText(label);
  await user.clear(box);
  if (text !== "") {
    await user.type(box, text);
  }
}

describe("a card AI drafted can be rewritten freely (CC-006, CC-008)", () => {
  it("offers a box for each part, named by its kind, and says what saving does", async () => {
    const { services } = await setUp();
    await renderApp(AI_CARD, services);

    expect(
      (
        (await screen.findByLabelText(
          "Part 1: Appreciation",
        )) as HTMLTextAreaElement
      ).value,
    ).toBe("I loved cooking with you on Sunday.");
    expect(
      (screen.getByLabelText("Part 2: Feeling") as HTMLTextAreaElement).value,
    ).toBe("It made me feel close to you.");
    expect(screen.getByText(OWNERSHIP_NOTE)).toBeTruthy();
    expect(screen.getByText(PARTS_HINT)).toBeTruthy();
  });

  // Changing a card AI drafted makes it the person's own (PRD AC-12).
  it("becomes the person's own when one part is changed, and only that part loses its AI notes", async () => {
    const { services, provider } = await setUp();
    await renderApp(AI_CARD, services);

    await retype(/^Part 2: Feeling/, "I felt close to you.");
    await press("Save changes");

    expect(await screen.findByText(STILL_HAS_NOTES)).toBeTruthy();
    const card = await services.records.get("conversation-card", SEED.thanks);
    expect(card?.authorship).toBe("user_owned");
    expect(card?.segments[1]).toEqual({
      id: card?.segments[1]?.id,
      category: "feeling",
      text: "I felt close to you.",
    });
    expect(card?.segments[0]?.evidenceKind).toBe("paraphrase");
    // The warning about saving is for AI cards only.
    expect(screen.queryByText(OWNERSHIP_NOTE)).toBeNull();
    // Editing calls no AI.
    expect(provider.calls).toEqual([]);
  });

  it("stays the AI's when Save is pressed with nothing changed", async () => {
    const { services } = await setUp();
    const before = await services.records.get("conversation-card", SEED.thanks);
    await renderApp(AI_CARD, services);
    await screen.findByLabelText("Part 1: Appreciation");

    await press("Save changes");

    await screen.findByText("Saved.");
    expect(
      await services.records.get("conversation-card", SEED.thanks),
    ).toEqual(before);
  });

  it("keeps exactly what is typed: nothing softens, corrects or refuses the wording", async () => {
    const { services } = await setUp();
    await renderApp(AI_CARD, services);
    const blunt = "You NEVER cook!! (i mean it)";

    await retype(/^Part 1: Appreciation/, blunt);
    await press("Save changes");

    await screen.findByText(STILL_HAS_NOTES);
    expect(
      (await services.records.get("conversation-card", SEED.thanks))
        ?.segments[0]?.text,
    ).toBe(blunt);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removes a part whose box is emptied", async () => {
    const { services } = await setUp();
    await renderApp(AI_CARD, services);

    await retype(/^Part 2: Feeling/, "");
    await press("Save changes");

    await screen.findByText(STILL_HAS_NOTES);
    const card = await services.records.get("conversation-card", SEED.thanks);
    expect(card?.segments.map((segment) => segment.text)).toEqual([
      "I loved cooking with you on Sunday.",
    ]);
  });

  // Rewriting it whole makes it theirs too, with no AI notes left (PRD AC-12).
  it("can be rewritten whole as one text, which leaves nothing of the AI's notes", async () => {
    const { services } = await setUp();
    await renderApp(AI_CARD, services);

    await press("Rewrite as one text");
    await retype(/What do you want to say/, "Thank you for Sunday.");
    await press("Save changes");

    await screen.findByText("Written by you.");
    const card = await services.records.get("conversation-card", SEED.thanks);
    expect(card).toMatchObject({
      authorship: "user_owned",
      sourceEntryIds: [],
    });
    expect(card?.segments).toEqual([
      {
        id: card?.segments[0]?.id,
        category: "other",
        text: "Thank you for Sunday.",
      },
    ]);
    // No learning mode is offered once nothing from the AI is left.
    expect(screen.queryByRole("radio", { name: /^Learning/ })).toBeNull();
  });

  it("can switch back to the parts without losing what the card says", async () => {
    const { services } = await setUp();
    await renderApp(AI_CARD, services);

    await press("Rewrite as one text");
    await press("Change the parts one by one");

    expect(
      (
        (await screen.findByLabelText(
          "Part 1: Appreciation",
        )) as HTMLTextAreaElement
      ).value,
    ).toBe("I loved cooking with you on Sunday.");
  });

  it("refuses to save a card with no words, and keeps it as it was", async () => {
    const { services } = await setUp();
    const before = await services.records.get("conversation-card", SEED.thanks);
    await renderApp(AI_CARD, services);

    await retype(/^Part 1: Appreciation/, "");
    await retype(/^Part 2: Feeling/, "");
    await press("Save changes");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Write something for the card",
    );
    expect(
      await services.records.get("conversation-card", SEED.thanks),
    ).toEqual(before);
  });
});

describe("learning mode after the card is the person's own", () => {
  it("is still offered for the parts that keep the AI's notes, and says a changed part is the person's words", async () => {
    const { services } = await setUp();
    await renderApp(AI_CARD, services);
    await retype(/^Part 2: Feeling/, "I felt close to you.");
    await press("Save changes");
    await screen.findByText(STILL_HAS_NOTES);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: /^Learning/ }));
    await user.click(
      screen.getByRole("button", { name: /feeling i felt close to you/i }),
    );

    const panel = within(
      await screen.findByRole("region", { name: "About this part" }),
    );
    expect(panel.getByText("These are your own words.")).toBeTruthy();
    expect(panel.queryByText(/Why this wording may help/)).toBeNull();
  });
});

describe("a card the person wrote", () => {
  it("with several parts, is changed part by part and keeps its other parts", async () => {
    const { services } = await setUp();
    await renderApp(OWN_CARD, services);

    await retype(/^Part 2: Request/, "Could we shop together on Saturday?");
    await press("Save changes");

    await screen.findByText(
      "The last two weekends I did the shopping on my own. Could we shop together on Saturday?",
    );
    const card = await services.records.get("conversation-card", SEED.chores);
    expect(card?.segments.map((segment) => segment.category)).toEqual([
      "observation",
      "request",
    ]);
    expect(screen.queryByText(OWNERSHIP_NOTE)).toBeNull();
  });

  it("with one part, has one box and no way to switch", async () => {
    const { services } = await setUp();
    await renderApp(ONE_PART, services);

    await screen.findByLabelText(/What do you want to say/);
    expect(
      screen.queryByRole("button", { name: "Rewrite as one text" }),
    ).toBeNull();
    expect(screen.queryByLabelText(/^Part 1/)).toBeNull();
  });
});
