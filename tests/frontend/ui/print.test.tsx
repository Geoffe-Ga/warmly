/**
 * The print view holds card text only (PRD CC-013; AC-13).
 */
import { cleanup, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { pathFor } from "../../../src/app/routes";
import type { ConversationCard } from "../../../src/domain/cards/types";
import { PAPER_NOTE } from "../../../src/ui/screens/prepare/Print";
import {
  ACCOUNT,
  renderApp,
  testServices,
  visit,
  type TestServices,
} from "../app/helpers";
import { SEED, seedCards } from "../app/seed-cards";

import styles from "../../../src/styles.css?raw";

const PRINT = pathFor("print", { id: SEED.sunday });
const CANARY_HASH = "c".repeat(64);
const TEACHING = "CANARY teaching explanation";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A card drafted by AI, carrying everything that must not be printed. */
const DRAFTED: ConversationCard = {
  id: "5eed0000-0000-4000-8000-00000000a009",
  collectionId: SEED.sunday,
  type: "need_request",
  authorship: "ai_generated",
  segments: [
    {
      id: "p1",
      category: "feeling",
      text: "When plans change late, I feel unsettled.",
      evidenceKind: "paraphrase",
      teachingExplanation: TEACHING,
      evidence: [
        {
          entryId: SEED.entry,
          responseKey: "improve",
          start: 4,
          end: 19,
          sourceHash: CANARY_HASH,
        },
      ],
    },
  ],
  sourceEntryIds: [SEED.entry],
  createdAt: "2026-11-05T09:00:00.000Z",
  updatedAt: "2026-11-06T09:00:00.000Z",
};

async function printing(): Promise<TestServices> {
  const services = testServices("unlocked");
  await seedCards(services.records);
  await services.records.put("conversation-card", DRAFTED);
  await renderApp(PRINT, services);
  await screen.findByRole("region", { name: "What will be printed" });
  return services;
}

function sheet(): HTMLElement {
  return screen.getByRole("region", { name: "What will be printed" });
}

describe("what the sheet holds (CC-013)", () => {
  it("is the collection's name and each card's words, in order, and nothing else", async () => {
    await printing();

    expect(sheet().textContent).toBe(
      [
        "Sunday talk",
        "I loved cooking with you on Sunday. It made me feel close to you.",
        "The last two weekends I did the shopping on my own. Could we plan next weekend's together on Thursday?",
        "What would make weekday evenings easier for you?",
        "When plans change late, I feel unsettled.",
      ].join(""),
    );
  });

  it("leaves out where a card came from, why it is worded that way, and who wrote it", async () => {
    await printing();
    const html = sheet().innerHTML;

    for (const absent of [
      TEACHING,
      "Naming one specific moment",
      CANARY_HASH,
      SEED.entry,
      "paraphrase",
      "inference",
      "Drafted by AI",
      "Written by you",
      "Appreciation",
      "Need and request",
      "feeling",
    ]) {
      expect(html).not.toContain(absent);
    }
  });

  it("leaves out dates, IDs and anything about the account or device", async () => {
    await printing();
    const html = sheet().innerHTML;

    expect(html).not.toMatch(/2026-\d\d-\d\d/);
    expect(html).not.toMatch(/5eed0000/);
    expect(html).not.toContain(ACCOUNT.email);
    expect(html).not.toMatch(/data-|href=|id="/);
  });

  it("holds no link, button, field or image", async () => {
    await printing();

    expect(sheet().querySelector("a, button, input, textarea, img")).toBeNull();
    expect(within(sheet()).getAllByRole("listitem")).toHaveLength(4);
  });
});

describe("printing is the person's act (CC-013)", () => {
  it("says before printing that paper is not protected", async () => {
    await printing();

    expect(screen.getByText(PAPER_NOTE)).toBeTruthy();
    expect(PAPER_NOTE).toMatch(/not protected/);
    expect(sheet().textContent).not.toContain(PAPER_NOTE);
  });

  it("opens the browser's print dialog only when Print is pressed, once per press", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    await printing();
    const user = userEvent.setup();

    expect(print).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Print" }));
    await user.click(screen.getByRole("button", { name: "Print" }));

    expect(print).toHaveBeenCalledTimes(2);
  });

  it("makes no file, writes nothing and calls no AI", async () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    const provider = new FakeProvider();
    const services = testServices("unlocked");
    await seedCards(services.records);
    const put = vi.spyOn(services.records, "put");
    const made = vi.spyOn(URL, "createObjectURL");
    await renderApp(PRINT, { ...services, ai: new AiGateway(provider) });
    await screen.findByRole("region", { name: "What will be printed" });
    put.mockClear();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Print" }));

    expect(put).not.toHaveBeenCalled();
    expect(made).not.toHaveBeenCalled();
    expect(provider.calls).toEqual([]);
    expect(sessionStorage.length + localStorage.length).toBe(0);
  });
});

describe("the print styles (CC-013)", () => {
  const print = styles.slice(styles.indexOf("@media print"));
  const rules = print.slice(0, print.indexOf("@media (prefers-reduced-motion"));

  it("print black on white, whatever the screen colours are", () => {
    expect(rules).toMatch(/background: white !important/);
    expect(rules).toMatch(/color: black !important/);
    expect(rules).not.toMatch(/var\(--color/);
  });

  it("remove everything around the sheet from the page", () => {
    expect(rules).toContain(".shell > :not(main)");
    expect(rules).toContain("main:has(.print-sheet) > :not(.stack)");
    expect(rules).toContain(
      "main:has(.print-sheet) .stack > :not(.print-sheet)",
    );
    expect(rules).toMatch(/display: none !important/);
  });

  it("keep a card on one page where that can be avoided", () => {
    expect(rules).toMatch(
      /\.print-sheet__cards > li \{\s*break-inside: avoid;/,
    );
  });
});
