import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainEvents } from "../../../src/domain/events";
import { PROMPTS, type JournalEntry } from "../../../src/domain/journal/types";
import { ANSWER_NEEDED } from "../../../src/domain/journal/validation";
import { StorageFullError } from "../../../src/storage/errors";

import { heading, renderApp, testServices, type TestServices } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ID = "00000000-0000-4000-8000-0000000000e1";
const PATH = "/sync/conflicts";

function version(changes: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: ID,
    createdAt: "2026-11-03T10:00:00.000Z",
    entryDate: { date: "2026-11-03", timeZone: "UTC" },
    updatedAt: "2026-11-04T09:00:00.000Z",
    status: "complete",
    responses: {
      good: "Mine good",
      improve: "Mine improve",
      loved: "Mine loved",
    },
    feelings: ["calm"],
    contentHash: "a".repeat(64),
    ...changes,
  };
}

const MINE = version();
const THEIRS = version({
  updatedAt: "2026-11-05T15:30:00.000Z",
  responses: {
    good: "Theirs good\nsecond line",
    improve: "Theirs improve",
    loved: "Theirs loved",
  },
  feelings: [],
  contentHash: "b".repeat(64),
});

/** Open the review screen with one entry changed in two places. */
async function open(
  // `null` means that side is deleted.
  mine: JournalEntry | null = MINE,
  theirs: JournalEntry | null = THEIRS,
): Promise<{
  services: TestServices;
  changed: DomainEvents["journal.changed"][];
  synced: ReturnType<typeof vi.spyOn>;
}> {
  const services = testServices("unlocked");
  if (mine !== null) {
    await services.records.put("journal-entry", mine);
  }
  services.records.park(ID, theirs ?? undefined);
  const changed: DomainEvents["journal.changed"][] = [];
  services.events.on("journal.changed", (event) => {
    changed.push(event);
  });
  const synced = vi.spyOn(services.sync, "sync");
  await renderApp(PATH, services);
  await waitFor(() => {
    expect(heading().textContent).toBe("Changed in two places");
  });
  return { services, changed, synced };
}

const card = (name: string): HTMLElement => {
  const title = screen.getByRole("heading", { name });
  const found = title.closest<HTMLElement>(".card");
  if (found === null) {
    throw new Error(`no card called ${name}`);
  }
  return found;
};

describe("reviewing an entry changed in two places (SYNC-004, AC-16)", () => {
  it("shows both versions in full, side by side, with when each was last changed", async () => {
    await open();

    await screen.findByRole("heading", { name: "Entry from November 3, 2026" });
    const mine = within(card("On this device"));
    const theirs = within(card("On your other device"));
    for (const prompt of PROMPTS) {
      expect(mine.getByText(prompt.label)).toBeTruthy();
      expect(theirs.getByText(prompt.label)).toBeTruthy();
    }
    expect(mine.getByText("Mine good")).toBeTruthy();
    expect(mine.getByText("calm")).toBeTruthy();
    expect(mine.getByText(/^Last changed .*2026/)).toBeTruthy();
    // Line breaks the person typed are kept.
    expect(theirs.getByText(/Theirs good\s+second line/)).toBeTruthy();
    expect(theirs.getByText("None.")).toBeTruthy();
    expect(
      screen.getByText(/Warmly never merges or picks for you/),
    ).toBeTruthy();
  });

  it("marks a draft and an unanswered question as what they are", async () => {
    await open(
      MINE,
      version({
        status: "draft",
        responses: { good: "Only this", improve: "", loved: "  " },
      }),
    );

    const theirs = within(await waitFor(() => card("On your other device")));
    expect(theirs.getByText(/A draft\./)).toBeTruthy();
    expect(theirs.getAllByText("Not answered.")).toHaveLength(2);
  });

  it("keeps this device's version when asked, says so, and syncs", async () => {
    const { services, changed, synced } = await open();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Keep this device's version" }),
    );

    await screen.findByText(/Kept the version from this device/);
    expect(await services.records.get("journal-entry", ID)).toEqual(MINE);
    expect(await services.records.conflicts("journal-entry")).toEqual([]);
    expect(screen.getByText("Nothing needs your attention.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Keep/ })).toBeNull();
    expect(document.activeElement).toBe(heading());
    expect(synced).toHaveBeenCalledTimes(1);
    expect(changed).toEqual([]);
  });

  it("keeps the other version when asked, replacing this device's, and announces the change", async () => {
    const { services, changed, synced } = await open();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Keep the other version" }),
    );

    await screen.findByText(/Kept the version from your other device/);
    expect(await services.records.get("journal-entry", ID)).toEqual(THEIRS);
    expect(changed).toEqual([
      { entryId: ID, oldHash: MINE.contentHash, newHash: THEIRS.contentHash },
    ]);
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it("lets the person write one version from both, starting from this device's", async () => {
    const { services, synced } = await open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Write one from both" }),
    );

    expect(heading().textContent).toBe("Write one version from both");
    expect(document.activeElement).toBe(heading());
    const good = screen.getByLabelText<HTMLTextAreaElement>(
      PROMPTS[0]?.label ?? "",
    );
    expect(good.value).toBe("Mine good");
    // The other version is still there to read while writing.
    expect(
      within(card("On your other device")).getByText("Theirs improve"),
    ).toBeTruthy();

    await user.clear(good);
    await user.type(good, "From both of them");
    await user.click(screen.getByRole("button", { name: "Save this version" }));

    await screen.findByText(/Saved the version you wrote/);
    expect(heading().textContent).toBe("Changed in two places");
    expect(await services.records.get("journal-entry", ID)).toMatchObject({
      id: ID,
      createdAt: MINE.createdAt,
      status: "complete",
      responses: {
        good: "From both of them",
        improve: "Mine improve",
        loved: "Mine loved",
      },
    });
    expect(await services.records.conflicts("journal-entry")).toEqual([]);
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it("does not save a finished entry with an empty answer, and says which", async () => {
    const { services } = await open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Write one from both" }),
    );
    const improve = screen.getByLabelText(PROMPTS[1]?.label ?? "");

    await user.clear(improve);
    await user.click(screen.getByRole("button", { name: "Save this version" }));

    expect(screen.getByText(ANSWER_NEEDED)).toBeTruthy();
    expect(document.activeElement).toBe(improve);
    expect(await services.records.get("journal-entry", ID)).toEqual(MINE);
    expect(await services.records.conflicts("journal-entry")).toHaveLength(1);
  });

  it("goes back without saving, with both versions untouched", async () => {
    const { services } = await open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Write one from both" }),
    );
    await user.type(screen.getByLabelText(PROMPTS[0]?.label ?? ""), " more");

    await user.click(
      screen.getByRole("button", { name: "Go back without saving" }),
    );

    expect(heading().textContent).toBe("Changed in two places");
    expect(await services.records.get("journal-entry", ID)).toEqual(MINE);
    expect(await services.records.conflicts("journal-entry")).toHaveLength(1);
    await screen.findByRole("button", { name: "Keep the other version" });
  });

  it("says nothing needs attention when nothing does", async () => {
    const services = testServices("unlocked");
    await renderApp(PATH, services);

    await screen.findByText("Nothing needs your attention.");
    expect(screen.queryByRole("button", { name: /Keep/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Back to your journal" }),
    ).toBeTruthy();
  });

  it("says what happened, and offers no choice, when one side is deleted", async () => {
    await open(MINE, null);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(
        /deleted on another device after you changed it here\. Your version is still on this device/,
      );
    });
    expect(screen.queryByRole("button", { name: /Keep/ })).toBeNull();
  });

  it("says the entry stays deleted here when it was deleted on this device", async () => {
    await open(null, THEIRS);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/It stays deleted here/);
    });
    expect(screen.queryByText("Theirs improve")).toBeNull();
  });

  it("treats an entry that was settled meanwhile as settled, not as an error", async () => {
    const { services } = await open();
    const user = userEvent.setup();
    const keep = await screen.findByRole("button", {
      name: "Keep the other version",
    });
    vi.spyOn(services.records, "conflicts").mockResolvedValue([]);

    await user.click(keep);

    await screen.findByText("That entry had already been settled.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so in plain words when the choice cannot be stored, and keeps both versions", async () => {
    const { services } = await open();
    const user = userEvent.setup();
    vi.spyOn(services.records, "resolve").mockRejectedValue(
      new StorageFullError(),
    );

    await user.click(
      await screen.findByRole("button", { name: "Keep the other version" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't do that");
    expect(alert.textContent).not.toContain("QuotaExceeded");
    expect(await services.records.conflicts("journal-entry")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Keep the other version" }),
    ).toBeTruthy();
  });

  it("says so when the journal cannot be opened", async () => {
    const services = testServices("unlocked");
    vi.spyOn(services.records, "conflicts").mockRejectedValue(
      new StorageFullError(),
    );

    await renderApp(PATH, services);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't open your journal");
  });

  it("is a private screen: nothing is shown while locked", async () => {
    const services = testServices("signed_in_locked");
    services.records.park(ID, THEIRS);

    await renderApp(PATH, services);

    expect(screen.queryByText("Theirs improve")).toBeNull();
    expect(heading().textContent).not.toBe("Changed in two places");
  });
});

describe("where the review is reached from (SYNC-010)", () => {
  it("the entry itself is still readable and says it was changed in two places", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", MINE);
    services.records.park(ID, THEIRS);

    await renderApp(`/journal/entries/${ID}`, services);

    const link = await screen.findByRole("link", {
      name: "Review the two versions",
    });
    expect(link.getAttribute("href")).toBe(PATH);
    expect(screen.getByText("Mine good")).toBeTruthy();
    expect(screen.queryByText("Theirs improve")).toBeNull();
  });

  it("an entry that is not in conflict says nothing about it", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", MINE);

    await renderApp(`/journal/entries/${ID}`, services);

    await screen.findByText("Mine good");
    expect(screen.queryByText(/Changed in two places/)).toBeNull();
  });

  it("the entry still opens if its conflict state cannot be read", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", MINE);
    vi.spyOn(services.records, "conflicts").mockRejectedValue(new Error("x"));

    await renderApp(`/journal/entries/${ID}`, services);

    await screen.findByText("Mine good");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
