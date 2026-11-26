/**
 * What the product says it is not, and who can read whose records (PRD
 * §0, RF-012, RF-013, AI-013; AC-26, AC-27).
 */
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReflectionAnswer } from "../../../src/ai/contracts";
import { importRootKey } from "../../../src/crypto/root-key";
import { newEntry } from "../../../src/domain/journal/types";
import { RecordReflectSessions } from "../../../src/domain/reflect/sessions";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import {
  ANSWER_IS_A_READING,
  CitedAnswer,
} from "../../../src/ui/components/CitedAnswer";
import {
  BOUNDARIES,
  IN_DANGER,
  WHAT_IS_CHECKED,
} from "../../../src/ui/screens/help/boundaries";
import { heading, renderApp, testServices, visit } from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

const SOURCES = import.meta.glob<string>("../../../src/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("the help page (RF-012, RF-013)", () => {
  it.each(["signed_out", "signed_in_locked", "unlocked"] as const)(
    "can be read while %s",
    async (state) => {
      await renderApp("/help", testServices(state));

      expect(heading().textContent).toBe("What Warmly is and is not");
      for (const boundary of BOUNDARIES) {
        expect(
          screen.getByRole("heading", { name: boundary.heading }),
        ).toBeTruthy();
        expect(screen.getByText(boundary.text)).toBeTruthy();
      }
      expect(screen.getByText(IN_DANGER)).toBeTruthy();
      expect(screen.getByText(WHAT_IS_CHECKED)).toBeTruthy();
    },
  );

  it("says each thing the product is not", () => {
    const all = BOUNDARIES.map((each) => `${each.heading} ${each.text}`).join(
      " ",
    );

    expect(BOUNDARIES.map((each) => each.heading)).toEqual([
      "Not therapy",
      "Not a medical or crisis service",
      "Not a judge of who is right",
      "A fallible aid",
    ]);
    expect(all).toContain("not a therapist or counsellor");
    expect(all).toContain("does not diagnose");
    expect(all).toContain("cannot help in an emergency");
    expect(all).toContain("does not decide who is right");
    expect(all).toContain("It can be wrong");
    expect(all).toContain("a possibility to check with them, not a fact");
  });

  it("says plainly that nothing watches the journal (RF-013)", () => {
    const crisis = BOUNDARIES[1].text;

    expect(crisis).toContain("nobody at Warmly reads what you write");
    expect(crisis).toContain(
      "It does not watch your journal for signs of crisis",
    );
    expect(crisis).toContain("there is no monitoring of any kind");
  });

  it("points to local emergency services, and names no number or country", () => {
    expect(IN_DANGER).toContain("contact your local emergency services now");
    expect(IN_DANGER).not.toMatch(/\d/);
  });

  it("is honest that tests cannot prove how a model behaves (§13.9)", () => {
    expect(WHAT_IS_CHECKED).toContain(
      "No test can prove how an AI model will behave",
    );
  });

  it("the app has no code that looks for crisis in what a person writes (RF-013)", () => {
    // A tripwire, not a proof: it catches the obvious names for such code
    // and nothing cleverer. The one file left out is the help page's own
    // text, which says that Warmly does none of this.
    const code = Object.entries(SOURCES).filter(
      ([path]) => !path.endsWith("/ui/screens/help/boundaries.tsx"),
    );

    expect(code.length).toBeGreaterThan(50);
    for (const [path, source] of code) {
      expect(source, path).not.toMatch(
        /suicid|self[- ]harm|crisis ?(detect|scor|classif|monitor)|sentiment/i,
      );
    }
  });
});

describe("where the boundaries are met (RF-012)", () => {
  it("sign-up says what Warmly is not, and links to the page", async () => {
    await renderApp("/welcome", testServices("signed_out"));

    const link = await screen.findByRole("link", {
      name: "What Warmly is and is not",
    });
    expect(link.getAttribute("href")).toBe("/help");
    expect(link.closest("p")?.textContent).toContain(
      "It is not therapy, a medical or crisis service, or a judge of who is right.",
    );
  });

  it("Reflect says it too, before any question is asked", async () => {
    await renderApp("/reflect", testServices("unlocked"));

    const link = await screen.findByRole("link", {
      name: "What Warmly is and is not",
    });
    expect(link.getAttribute("href")).toBe("/help");
  });
});

describe("every answer is marked as a reading (AI-013, AC-26)", () => {
  const answer: ReflectionAnswer = {
    markdown:
      "Your partner certainly feels guilty and you are definitely right.",
    citations: [],
    sources: [],
    coverage: { includedEntryIds: [], omittedEntryCount: 0, truncated: false },
  };

  it("says so under the answer, whatever the answer claims", () => {
    const { container } = render(<CitedAnswer answer={answer} entries={[]} />);

    const last = container.querySelector(".cited-answer")?.lastElementChild;
    expect(last?.textContent).toBe(ANSWER_IS_A_READING);
  });

  it("keeps the person's own words apart from the AI's guesses, in words", () => {
    expect(ANSWER_IS_A_READING).toContain("it can be wrong");
    expect(ANSWER_IS_A_READING).toContain(
      "The quoted words are yours, as you wrote them.",
    );
    expect(ANSWER_IS_A_READING).toContain(
      "is a possibility to check, not a fact",
    );
    expect(ANSWER_IS_A_READING).toContain(
      "not advice from a therapist or a doctor",
    );
  });
});

describe("Reflect reads only the signed-in person's records (AC-27)", () => {
  const OWNER_A = "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90";
  const OWNER_B = "1c1f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c91";
  const key = (fill: number) =>
    importRootKey(Uint8Array.from({ length: 32 }, (_unused, i) => i + fill));
  let made = 0;
  const names = () => {
    made += 1;
    const prefix = `boundaries-test-${String(made)}`;
    return (owner: string) => `${prefix}-${owner}`;
  };

  async function withJournal(store: EncryptedRecordStore): Promise<void> {
    const entry = await newEntry({
      good: "CANARY private to its owner",
      improve: "Synthetic",
      loved: "Synthetic",
    });
    await store.put("journal-entry", entry);
    await new RecordReflectSessions(store).start({
      question: "CANARY question?",
      answer: {
        markdown: "CANARY answer.",
        citations: [],
        sources: [{ entryId: entry.id, sourceHash: entry.contentHash }],
        coverage: {
          includedEntryIds: [entry.id],
          omittedEntryCount: 0,
          truncated: false,
        },
      },
    });
  }

  it("another account on the same device sees none of it", async () => {
    const name = names();
    const a = new EncryptedRecordStore(name);
    a.unlock(await key(0), OWNER_A);
    await withJournal(a);

    const b = new EncryptedRecordStore(name);
    b.unlock(await key(7), OWNER_B);

    expect(await b.list("journal-entry")).toEqual([]);
    expect(await new RecordReflectSessions(b).list()).toEqual([]);
    expect(await a.list("journal-entry")).toHaveLength(1);
  });

  it("another account's key cannot read the records even if pointed at the same database", async () => {
    const shared = () => "boundaries-test-shared-database";
    const a = new EncryptedRecordStore(shared);
    a.unlock(await key(0), OWNER_A);
    await withJournal(a);

    const b = new EncryptedRecordStore(shared);
    b.unlock(await key(7), OWNER_B);

    // The rows are there, and none of them can be opened.
    expect(await b.list("journal-entry")).toEqual([]);
    expect(await new RecordReflectSessions(b).list()).toEqual([]);
    expect(await b.unreadable("journal-entry")).toBe(1);
    expect(await b.unreadable("reflect-session")).toBe(1);
  });

  it("the same account's key with another owner's ID cannot read them either", async () => {
    const shared = () => "boundaries-test-owner-binding";
    const a = new EncryptedRecordStore(shared);
    a.unlock(await key(0), OWNER_A);
    await withJournal(a);

    const b = new EncryptedRecordStore(shared);
    b.unlock(await key(0), OWNER_B);

    expect(await b.list("journal-entry")).toEqual([]);
    expect(await b.unreadable("journal-entry")).toBe(1);
  });

  it("Reflect code takes its records from the one store it is given, and has no account or owner to choose", () => {
    const reflect = Object.entries(SOURCES).filter(
      ([path]) =>
        path.includes("/src/domain/reflect/") ||
        path.includes("/src/ui/screens/reflect/") ||
        path.includes("/src/domain/deps/"),
    );

    expect(reflect.length).toBeGreaterThanOrEqual(8);
    for (const [path, source] of reflect) {
      expect(source, path).not.toMatch(
        /ownerId|owner_id|accountId|userId|household|partnerId|api\/client|\bfetch\(/,
      );
    }
  });
});
