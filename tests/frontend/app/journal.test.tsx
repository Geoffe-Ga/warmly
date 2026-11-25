import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lockNow } from "../../../src/app/SessionControls";
import { PROMPTS, type JournalEntry } from "../../../src/domain/journal/types";
import { CANNOT_OPEN } from "../../../src/ui/screens/journal/shared";
import {
  formatEntryDate,
  inTimelineOrder,
  saveNewEntry,
} from "../../../src/ui/screens/journal/shared";

import { heading, renderApp, testServices, type TestServices } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function entry(
  number: number,
  date: string,
  changes: Partial<JournalEntry> = {},
): JournalEntry {
  return {
    id: `00000000-0000-4000-8000-0000000000a${String(number)}`,
    createdAt: `${date}T10:00:00.000Z`,
    entryDate: { date, timeZone: "UTC" },
    updatedAt: `${date}T10:00:00.000Z`,
    status: "complete",
    responses: {
      good: `Good ${String(number)}`,
      improve: `Improve ${String(number)}`,
      loved: `Loved ${String(number)}`,
    },
    contentHash: "0".repeat(64),
    ...changes,
  };
}

async function unlockedWith(...entries: JournalEntry[]): Promise<TestServices> {
  const services = testServices("unlocked");
  for (const one of entries) {
    await services.records.put("journal-entry", one);
  }
  return services;
}

function entryLinks(): string[] {
  return within(screen.getByRole("navigation", { name: "Entries" }))
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("the journal timeline (JR-001)", () => {
  it("lists entries newest first by their date, marking drafts", async () => {
    await renderApp(
      "/journal",
      await unlockedWith(
        entry(1, "2026-11-03"),
        entry(2, "2026-11-10", { status: "draft" }),
        entry(3, "2026-10-01"),
      ),
    );

    await screen.findByRole("navigation", { name: "Entries" });

    expect(heading().textContent).toBe("Journal");
    expect(entryLinks()).toEqual([
      `${formatEntryDate({ date: "2026-11-10", timeZone: "UTC" })} (draft)`,
      formatEntryDate({ date: "2026-11-03", timeZone: "UTC" }),
      formatEntryDate({ date: "2026-10-01", timeZone: "UTC" }),
    ]);
  });

  it("links each entry by its opaque ID, never by its text", async () => {
    await renderApp("/journal", await unlockedWith(entry(1, "2026-11-03")));

    const link = within(
      await screen.findByRole("navigation", { name: "Entries" }),
    ).getByRole("link");

    expect(link.getAttribute("href")).toBe(
      "/journal/entries/00000000-0000-4000-8000-0000000000a1",
    );
  });

  it("says so when nothing has been written, and offers a new entry", async () => {
    await renderApp("/journal", await unlockedWith());

    expect(
      await screen.findByText("You haven't written anything yet."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Write a new entry" })
        .getAttribute("href"),
    ).toBe("/journal/new");
  });

  it("no longer warns that entries are not saved", async () => {
    await renderApp("/journal", await unlockedWith());
    await screen.findByText("You haven't written anything yet.");

    expect(screen.queryByText(/not saved/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so, and shows no entries, when what is saved cannot be opened (§13.6)", async () => {
    const services = testServices("unlocked");
    services.records.list = () => Promise.reject(new Error("synthetic"));

    await renderApp("/journal", services);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(CANNOT_OPEN);
    expect(alert.textContent).toContain("Nothing has been changed or deleted");
    expect(screen.queryByText("You haven't written anything yet.")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Entries" })).toBeNull();
  });

  it.each([
    [1, "1 entry saved on this device can't be read"],
    [3, "3 entries saved on this device can't be read"],
  ])(
    "says how many entries it could not read, and still lists the rest (%i)",
    async (count, text) => {
      const services = await unlockedWith(entry(1, "2026-11-03"));
      services.records.unreadable = () => Promise.resolve(count);

      await renderApp("/journal", services);

      expect(
        (await screen.findByText(text, { exact: false })).closest(
          "[role=status]",
        ),
      ).not.toBeNull();
      expect(entryLinks()).toHaveLength(1);
    },
  );

  it("says so on an entry's page when what is saved cannot be opened", async () => {
    const services = testServices("unlocked");
    services.records.get = () => Promise.reject(new Error("synthetic"));

    await renderApp(
      "/journal/entries/00000000-0000-4000-8000-0000000000a1",
      services,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      CANNOT_OPEN,
    );
  });

  it("narrows the list as the search box is typed in, ignoring case, without changing the address", async () => {
    await renderApp(
      "/journal",
      await unlockedWith(
        entry(1, "2026-11-03", {
          responses: { good: "The WALK was lovely", improve: "x", loved: "y" },
        }),
        entry(2, "2026-11-10"),
      ),
    );
    await screen.findByRole("navigation", { name: "Entries" });

    await userEvent.type(screen.getByLabelText("Search your journal"), "walk");

    expect(entryLinks()).toEqual([
      formatEntryDate({ date: "2026-11-03", timeZone: "UTC" }),
    ]);
    expect(window.location.pathname).toBe("/journal");
    expect(window.location.search).toBe("");

    await userEvent.type(screen.getByLabelText("Search your journal"), "zzz");
    expect(screen.getByText("No entry mentions that.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Entries" })).toBeNull();
  });

  it("shows a new entry as soon as it is stored", async () => {
    const services = await unlockedWith(entry(1, "2026-11-03"));
    await renderApp("/journal", services);
    await screen.findByRole("navigation", { name: "Entries" });

    await services.records.put("journal-entry", entry(2, "2026-11-10"));

    await waitFor(() => {
      expect(entryLinks()).toHaveLength(2);
    });
  });

  it("sorts by day, then by when the entry was created", () => {
    const early = entry(1, "2026-11-10");
    const late = entry(2, "2026-11-10", {
      createdAt: "2026-11-10T18:00:00.000Z",
    });
    const older = entry(3, "2026-11-01");

    expect(inTimelineOrder([older, early, late]).map((one) => one.id)).toEqual([
      late.id,
      early.id,
      older.id,
    ]);
  });
});

describe("writing an entry (JR-001)", () => {
  it("shows the three prompts in PRD order, each with its own text box", async () => {
    await renderApp("/journal/new", await unlockedWith());

    const boxes = screen.getAllByRole("textbox");

    expect(heading().textContent).toBe("New journal entry");
    expect(
      boxes.map(
        (box) => document.querySelector(`label[for="${box.id}"]`)?.textContent,
      ),
    ).toEqual(PROMPTS.map((prompt) => prompt.label));
    expect(boxes.every((box) => box.tagName === "TEXTAREA")).toBe(true);
  });

  it("has no skip control, and says an honest 'nothing' is a real answer", async () => {
    await renderApp("/journal/new", await unlockedWith());

    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /skip/i })).toBeNull();
    expect(screen.getByText(/That is a real answer\./)).toBeTruthy();
  });

  it("saves what was typed and opens the new entry", async () => {
    const services = await renderApp("/journal/new", await unlockedWith());

    for (const [index, prompt] of PROMPTS.entries()) {
      await userEvent.type(
        screen.getByLabelText(prompt.label),
        `Answer ${String(index + 1)}`,
      );
    }
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    const [saved] = await waitFor(async () => {
      const all = await services.records.list("journal-entry");
      expect(all).toHaveLength(1);
      return all;
    });
    expect(saved?.responses).toEqual({
      good: "Answer 1",
      improve: "Answer 2",
      loved: "Answer 3",
    });
    expect(saved?.status).toBe("complete");
    await waitFor(() => {
      expect(window.location.pathname).toBe(
        `/journal/entries/${saved?.id ?? ""}`,
      );
    });
    expect(await screen.findByText("Answer 2")).toBeTruthy();
  });

  it("keeps an unfinished entry as a draft", async () => {
    const services = await renderApp("/journal/new", await unlockedWith());

    await userEvent.type(screen.getByLabelText(PROMPTS[0]?.label ?? ""), "One");
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(async () => {
      expect((await services.records.list("journal-entry"))[0]?.status).toBe(
        "draft",
      );
    });
    expect(await screen.findByText(/A draft:/)).toBeTruthy();
    expect(screen.getAllByText("Not answered yet.")).toHaveLength(2);
  });
});

describe("reading an entry (JR-001)", () => {
  it("shows its date and each answer under its question, keeping line breaks", async () => {
    const one = entry(1, "2026-11-03", {
      responses: { good: "First line\nSecond line", improve: "B", loved: "C" },
    });
    await renderApp(`/journal/entries/${one.id}`, await unlockedWith(one));

    await waitFor(() => {
      expect(heading().textContent).toBe(formatEntryDate(one.entryDate));
    });
    const sections = PROMPTS.map(
      (prompt) =>
        screen
          .getByRole("heading", { level: 2, name: prompt.label })
          .closest("section") as HTMLElement,
    );
    expect(
      within(sections[0] as HTMLElement)
        .getAllByText(/line$/)
        .map((p) => p.textContent),
    ).toEqual(["First line", "Second line"]);
    expect(within(sections[1] as HTMLElement).getByText("B")).toBeTruthy();
    expect(within(sections[2] as HTMLElement).getByText("C")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Back to your journal" })
        .getAttribute("href"),
    ).toBe("/journal");
  });

  it("says so when the entry is not on this device, without guessing why", async () => {
    await renderApp(
      "/journal/entries/00000000-0000-4000-8000-0000000000ff",
      await unlockedWith(),
    );

    expect(
      (await screen.findByText(/This entry isn't on this device/)).getAttribute(
        "role",
      ),
    ).toBe("status");
    expect(heading().textContent).toBe("Journal entry");
  });

  it("goes from the timeline to an entry and back", async () => {
    const one = entry(1, "2026-11-03");
    await renderApp("/journal", await unlockedWith(one));

    await userEvent.click(
      within(
        await screen.findByRole("navigation", { name: "Entries" }),
      ).getByRole("link"),
    );
    expect(await screen.findByText("Improve 1")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("link", { name: "Back to your journal" }),
    );
    await waitFor(() => {
      expect(heading().textContent).toBe("Journal");
    });
  });
});

describe("journal content and the lock (DEV-005)", () => {
  it("is dropped from memory when the app locks", async () => {
    const services = await unlockedWith(entry(1, "2026-11-03"));

    await lockNow(services, () => undefined);

    expect(await services.records.list("journal-entry")).toEqual([]);
  });

  it("an entry still being prepared when the app locks is never stored", async () => {
    const services = await unlockedWith();
    const answers = { good: "Private", improve: "text", loved: "here" };

    // Hashing the entry is asynchronous, so the lock lands in the middle.
    const saving = saveNewEntry(services, answers);
    await lockNow(services, () => undefined);

    expect(await saving).toBeUndefined();
    expect(await services.records.list("journal-entry")).toEqual([]);
  });

  it("an entry is stored when the app stays unlocked", async () => {
    const services = await unlockedWith();

    const saved = await saveNewEntry(services, {
      good: "a",
      improve: "b",
      loved: "c",
    });

    expect(await services.records.list("journal-entry")).toEqual([saved]);
  });

  it.each(["signed_out", "signed_in_locked"] as const)(
    "no journal screen is shown while %s",
    async (state) => {
      const services = testServices(state);
      await services.records.put("journal-entry", entry(1, "2026-11-03"));

      for (const path of [
        "/journal",
        "/journal/new",
        "/journal/entries/00000000-0000-4000-8000-0000000000a1",
      ]) {
        cleanup();
        await renderApp(path, services);
        expect(screen.queryByText("Good 1")).toBeNull();
        expect(screen.queryByLabelText("Search your journal")).toBeNull();
        expect(screen.queryByRole("button", { name: "Save entry" })).toBeNull();
      }
    },
  );
});
