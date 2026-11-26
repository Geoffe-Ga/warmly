/**
 * A checked answer as prose with links to the person's own entries (PRD
 * RF-005, RF-008, SEC-010; AC-07, AC-26).
 */
import { cleanup, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import type { ReflectionAnswer, SourceRef } from "../../../src/ai/contracts";
import { pathFor } from "../../../src/app/routes";
import type { JournalEntry } from "../../../src/domain/journal/types";
import {
  CitedAnswer,
  SOURCE_CHANGED,
  SOURCE_GONE,
  coverageNote,
} from "../../../src/ui/components/CitedAnswer";
import { formatEntryDate } from "../../../src/ui/screens/journal/shared";

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
    improve: "I want to interrupt less.",
    loved: "They left a note in my bag.",
  },
  contentHash: "1".repeat(64),
};
const OTHER: JournalEntry = {
  ...ENTRY,
  id: "00000000-0000-4000-8000-0000000000e2",
  entryDate: { date: "2026-11-10", timeZone: "UTC" },
  responses: { good: "Our walk was quiet.", improve: "x", loved: "y" },
  contentHash: "2".repeat(64),
};

function ref(
  entry: JournalEntry,
  key: SourceRef["responseKey"],
  words: string,
): SourceRef {
  const start = entry.responses[key].indexOf(words);
  return {
    entryId: entry.id,
    responseKey: key,
    start,
    end: start + words.length,
    sourceHash: entry.contentHash,
  };
}

function answer(
  markdown: string,
  citations: ReflectionAnswer["citations"],
): ReflectionAnswer {
  return {
    markdown,
    citations,
    sources: [],
    coverage: { includedEntryIds: [], omittedEntryCount: 0, truncated: false },
  };
}

const COOKED = ref(ENTRY, "good", "cooked dinner together");
const NOTE = ref(ENTRY, "loved", "left a note");
const WALK = ref(OTHER, "good", "walk was quiet");

function sources(): HTMLElement {
  return screen.getByRole("region", {
    name: "Where this comes from in your journal",
  });
}

describe("an answer about part of the journal (RF-004, AC-09)", () => {
  const partial: ReflectionAnswer = {
    ...answer("Synthetic prose that claims to cover everything.", []),
    sources: [],
    coverage: {
      includedEntryIds: Array.from({ length: 1200 }, (_unused, index) =>
        String(index),
      ),
      omittedEntryCount: 3800,
      truncated: true,
    },
  };

  it("says above the prose how many entries it is about, whatever the prose says", () => {
    const { container } = render(
      <CitedAnswer answer={partial} entries={[ENTRY]} />,
    );
    const note =
      "This answer is about 1,200 of the 5,000 journal entries you had when you asked. The others did not fit in one request, so it does not speak for your whole journal.";

    expect(coverageNote(partial)).toBe(note);
    expect(
      container.querySelector(".cited-answer")?.firstElementChild?.textContent,
    ).toBe(note);
  });

  it("says nothing of the kind when every entry was sent", () => {
    const whole = answer("Synthetic prose.", []);
    render(<CitedAnswer answer={whole} entries={[ENTRY]} />);

    expect(coverageNote(whole)).toBeUndefined();
    expect(
      screen.queryByText(/does not speak for your whole journal/),
    ).toBeNull();
  });

  it("goes by the count as well as the flag, so a stored answer with either is marked", () => {
    expect(
      coverageNote({
        ...partial,
        coverage: { ...partial.coverage, truncated: false },
      }),
    ).toContain("1,200 of the 5,000");
    expect(
      coverageNote({
        ...partial,
        coverage: { ...partial.coverage, omittedEntryCount: 0 },
      }),
    ).toContain("1,200 of the 1,200");
  });
});

describe("the prose (RF-005)", () => {
  it("is ordinary paragraphs, with each claim's mark turned into numbered links", () => {
    render(
      <CitedAnswer
        answer={answer("You cooked together. [c1]\n\nYou also walked. [c2]", [
          { claimId: "c1", evidence: [COOKED] },
          { claimId: "c2", evidence: [WALK, NOTE] },
        ])}
        entries={[ENTRY, OTHER]}
      />,
    );

    const paragraphs = [
      ...document.querySelectorAll(".cited-answer > p:not(.hint)"),
    ];
    expect(paragraphs.map((each) => each.textContent)).toEqual([
      "You cooked together. [1]",
      "You also walked. [2][3]",
    ]);
    expect(document.body.textContent).not.toMatch(/\[c\d\]/);
  });

  it("each link opens the person's own entry and says which source it is", () => {
    render(
      <CitedAnswer
        answer={answer("A [c1] and B [c2]", [
          { claimId: "c1", evidence: [COOKED] },
          { claimId: "c2", evidence: [WALK] },
        ])}
        entries={[ENTRY, OTHER]}
      />,
    );

    const first = screen.getByRole("link", {
      name: `Source 1: your entry from ${formatEntryDate(ENTRY.entryDate)}`,
    });
    const second = screen.getByRole("link", {
      name: `Source 2: your entry from ${formatEntryDate(OTHER.entryDate)}`,
    });
    expect(first.getAttribute("href")).toBe(
      pathFor("journal-entry", { id: ENTRY.id }),
    );
    expect(second.getAttribute("href")).toBe(
      pathFor("journal-entry", { id: OTHER.id }),
    );
    expect(first.textContent).toBe("[1]");
  });

  it("gives the same place one number however often it is cited", () => {
    render(
      <CitedAnswer
        answer={answer("A [c1] B [c2]", [
          { claimId: "c1", evidence: [COOKED] },
          { claimId: "c2", evidence: [COOKED, NOTE] },
        ])}
        entries={[ENTRY]}
      />,
    );

    expect(
      document.querySelector(".cited-answer > p:not(.hint)")?.textContent,
    ).toBe("A [1] B [1][2]");
    expect(within(sources()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows an answer that cites nothing as plain prose with no sources", () => {
    render(
      <CitedAnswer
        answer={answer("There is not enough here to say.", [])}
        entries={[ENTRY]}
      />,
    );

    expect(screen.getByText("There is not enough here to say.")).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leaves a mark with no citation behind it out, and keeps the words", () => {
    render(<CitedAnswer answer={answer("A [c7] B", [])} entries={[ENTRY]} />);

    expect(
      document.querySelector(".cited-answer > p:not(.hint)")?.textContent,
    ).toBe("A  B");
  });

  it("drops empty paragraphs and keeps single line breaks inside one", () => {
    render(
      <CitedAnswer
        answer={answer("First line\nsecond line\n\n\n\n   \n\nLast.", [])}
        entries={[]}
      />,
    );

    expect(
      [...document.querySelectorAll(".cited-answer > p:not(.hint)")].map(
        (each) => each.textContent,
      ),
    ).toEqual(["First line\nsecond line", "Last."]);
  });
});

describe("the sources (RF-005, AC-26)", () => {
  it("lists each place with its entry's day and the exact words it points to", () => {
    render(
      <CitedAnswer
        answer={answer("A [c1] B [c2]", [
          { claimId: "c1", evidence: [COOKED] },
          { claimId: "c2", evidence: [WALK] },
        ])}
        entries={[ENTRY, OTHER]}
      />,
    );

    const items = within(sources()).getAllByRole("listitem");
    expect(items.map((each) => each.textContent)).toEqual([
      `Your entry from ${formatEntryDate(ENTRY.entryDate)}: cooked dinner together`,
      `Your entry from ${formatEntryDate(OTHER.entryDate)}: walk was quiet`,
    ]);
    expect(items[0]?.querySelector("q")?.textContent).toBe(
      "cooked dinner together",
    );
    expect(
      within(items[0] as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe(pathFor("journal-entry", { id: ENTRY.id }));
  });

  it("does not show words from an entry that has changed since the answer", () => {
    const changed = {
      ...ENTRY,
      responses: { ...ENTRY.responses, good: "CANARY rewritten since then." },
      contentHash: "9".repeat(64),
    };
    render(
      <CitedAnswer
        answer={answer("A [c1]", [{ claimId: "c1", evidence: [COOKED] }])}
        entries={[changed]}
      />,
    );

    const [item] = within(sources()).getAllByRole("listitem");
    expect(item?.textContent).toContain(SOURCE_CHANGED);
    expect(item?.textContent).not.toContain("CANARY");
    expect(item?.querySelector("q")).toBeNull();
    // The entry is still the person's, so it can still be opened.
    expect(within(item as HTMLElement).getByRole("link")).toBeTruthy();
  });

  it("says so when an entry is gone, and makes no link to it", () => {
    render(
      <CitedAnswer
        answer={answer("A [c1]", [{ claimId: "c1", evidence: [COOKED] }])}
        entries={[]}
      />,
    );

    expect(within(sources()).getByRole("listitem").textContent).toBe(
      SOURCE_GONE,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      document.querySelector(".cited-answer > p:not(.hint)")?.textContent,
    ).toBe("A [1]");
  });
});

describe("answer text is only ever text (SEC-010)", () => {
  it("shows HTML, scripts, images and links in an answer as characters", () => {
    const hostile =
      '<script>alert(1)</script><img src=x onerror=alert(1)> [click](https://example.invalid/?q=journal) ![x](https://example.invalid/x.png) <a href="https://example.invalid">out</a> [c1]';
    render(
      <CitedAnswer
        answer={answer(hostile, [{ claimId: "c1", evidence: [COOKED] }])}
        entries={[ENTRY]}
      />,
    );

    expect(document.querySelector("script, img")).toBeNull();
    // The only links are the ones made here, to the person's own entry.
    const links = screen.getAllByRole("link");
    expect(
      links.every((link) => link.getAttribute("href")?.startsWith("/journal/")),
    ).toBe(true);
    expect(document.body.innerHTML).not.toContain('example.invalid">');
    expect(
      document.querySelector(".cited-answer > p:not(.hint)")?.textContent,
    ).toContain("<script>alert(1)</script>");
  });
});
