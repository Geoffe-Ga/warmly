import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { endRevokedDevice, lockNow } from "../../../src/app/SessionControls";
import { AUTOSAVE_DELAY_MS } from "../../../src/domain/journal/drafts";
import { FEELINGS } from "../../../src/domain/journal/feelings";
import { PROMPTS, type JournalEntry } from "../../../src/domain/journal/types";
import { ANSWER_NEEDED } from "../../../src/domain/journal/validation";
import {
  DRAFT_NOT_SAVED,
  DRAFT_SAVED,
} from "../../../src/ui/screens/journal/Compose";
import { CANNOT_OPEN } from "../../../src/ui/screens/journal/shared";
import {
  formatEntryDate,
  inTimelineOrder,
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

/** Open the compose screen and wait until its form is ready. */
async function openCompose(
  services?: TestServices | Promise<TestServices>,
): Promise<TestServices> {
  const opened = await renderApp(
    "/journal/new",
    (await services) ?? (await unlockedWith()),
  );
  await screen.findByRole("button", { name: "Save entry" });
  return opened;
}

function entryLinks(): string[] {
  return within(screen.getByRole("navigation", { name: "Entries" }))
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("the journal timeline (JR-001)", () => {
  it("lists completed entries newest first by their date, and shows the draft apart from them (JR-004)", async () => {
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
      formatEntryDate({ date: "2026-11-03", timeZone: "UTC" }),
      formatEntryDate({ date: "2026-10-01", timeZone: "UTC" }),
    ]);
    const draft = within(
      screen.getByRole("navigation", { name: "Draft" }),
    ).getByRole("link");
    expect(draft.textContent).toBe(
      `Carry on with your draft from ${formatEntryDate({ date: "2026-11-10", timeZone: "UTC" })}`,
    );
    expect(draft.getAttribute("href")).toBe("/journal/new");
    // With a draft under way there is one way in to writing, not two.
    expect(
      screen.queryByRole("link", { name: "Write a new entry" }),
    ).toBeNull();
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

  it("with only a draft, says no entry is finished yet rather than that nothing was written", async () => {
    await renderApp(
      "/journal",
      await unlockedWith(entry(2, "2026-11-10", { status: "draft" })),
    );

    expect(
      await screen.findByText("You haven't finished an entry yet."),
    ).toBeTruthy();
    expect(screen.queryByText("You haven't written anything yet.")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Entries" })).toBeNull();
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
    await openCompose();

    const boxes = screen.getAllByRole("textbox");

    expect(heading().textContent).toBe("New journal entry");
    expect(
      boxes.map(
        (box) => document.querySelector(`label[for="${box.id}"]`)?.textContent,
      ),
    ).toEqual(PROMPTS.map((prompt) => prompt.label));
    expect(boxes.every((box) => box.tagName === "TEXTAREA")).toBe(true);
  });

  it("has no skip control, and says before the questions that an honest 'nothing' is a real answer (JR-002)", async () => {
    await openCompose();

    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /skip/i })).toBeNull();
    const help = screen.getByText(/That is a real answer\./);
    expect(help.textContent).toContain("Each question needs an answer");
    expect(
      help.compareDocumentPosition(
        screen.getByLabelText(PROMPTS[0]?.label ?? ""),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const prompt of PROMPTS) {
      expect(screen.getByLabelText(prompt.label)).toHaveProperty(
        "required",
        true,
      );
      expect(
        screen.getByLabelText(prompt.label).hasAttribute("aria-invalid"),
      ).toBe(false);
    }
  });

  it("saves what was typed and opens the new entry", async () => {
    const services = await openCompose();

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

  it("saves nothing while an answer is blank or only spaces, and says so on each such field (AC-02)", async () => {
    const services = await openCompose();
    const [good, improve, loved] = PROMPTS.map((prompt) =>
      screen.getByLabelText(prompt.label),
    );

    await userEvent.type(good as HTMLElement, "One");
    await userEvent.type(improve as HTMLElement, "  {Enter} ");
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => {
      expect(improve?.getAttribute("aria-invalid")).toBe("true");
    });
    expect(loved?.getAttribute("aria-invalid")).toBe("true");
    expect(good?.hasAttribute("aria-invalid")).toBe(false);
    for (const field of [improve, loved]) {
      const described = (field?.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent);
      expect(described).toContain(ANSWER_NEEDED);
    }
    // Focus goes to the first field that needs an answer.
    await waitFor(() => {
      expect(document.activeElement).toBe(improve);
    });
    expect(await services.records.list("journal-entry")).toEqual([]);
    expect(window.location.pathname).toBe("/journal/new");
    // What was typed is still there.
    expect(good).toHaveProperty("value", "One");
  });

  it("drops a field's message as soon as it has text, and then saves", async () => {
    const services = await openCompose();
    const [good, improve, loved] = PROMPTS.map((prompt) =>
      screen.getByLabelText(prompt.label),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));
    await waitFor(() => {
      expect(screen.getAllByText(ANSWER_NEEDED)).toHaveLength(3);
    });
    expect(document.activeElement).toBe(good);

    await userEvent.type(
      good as HTMLElement,
      "Nothing comes to mind this week",
    );
    expect(screen.getAllByText(ANSWER_NEEDED)).toHaveLength(2);
    await userEvent.type(improve as HTMLElement, "no");
    await userEvent.type(loved as HTMLElement, "x");
    expect(screen.queryByText(ANSWER_NEEDED)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    const [saved] = await waitFor(async () => {
      const all = await services.records.list("journal-entry");
      expect(all).toHaveLength(1);
      return all;
    });
    expect(saved?.status).toBe("complete");
    expect(saved?.responses.good).toBe("Nothing comes to mind this week");
    expect(saved?.feelings).toBeUndefined();
  });

  it("offers the feelings check-in as optional checkboxes, none chosen (JR-003)", async () => {
    await openCompose();

    const group = screen.getByRole("group", {
      name: "How are you feeling? (optional)",
    });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("value"))).toEqual([
      ...FEELINGS,
    ]);
    expect(boxes.some((box) => (box as HTMLInputElement).checked)).toBe(false);
    expect(boxes.some((box) => (box as HTMLInputElement).required)).toBe(false);
  });

  it("stores the feelings that were chosen, and never guesses any from the text", async () => {
    const services = await openCompose();
    for (const prompt of PROMPTS) {
      await userEvent.type(
        screen.getByLabelText(prompt.label),
        "I felt sad and anxious",
      );
    }
    await userEvent.click(screen.getByLabelText("hopeful"));
    await userEvent.click(screen.getByLabelText("calm"));
    await userEvent.click(screen.getByLabelText("tired"));
    await userEvent.click(screen.getByLabelText("tired"));
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    const [saved] = await waitFor(async () => {
      const all = await services.records.list("journal-entry");
      expect(all).toHaveLength(1);
      return all;
    });
    expect(saved?.feelings).toEqual(["calm", "hopeful"]);
    const noted = (
      await screen.findByRole("heading", {
        level: 2,
        name: "Feelings you noted",
      })
    ).closest("section");
    expect(noted?.textContent).toContain("calm, hopeful");
  });
});

describe("drafts (JR-004)", () => {
  const first = (): HTMLElement =>
    screen.getByLabelText(PROMPTS[0]?.label ?? "");

  /** Make the page look hidden, as when the tab is switched away from. */
  function hidePage(): void {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  }

  async function drafts(services: TestServices): Promise<JournalEntry[]> {
    return (await services.records.list("journal-entry")).filter(
      (each) => each.status === "draft",
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves what is typed as a draft a moment after typing stops, and says so", async () => {
    const services = await openCompose();
    expect(screen.getByRole("status").textContent).toBe("");

    await userEvent.type(first(), "half a thought");
    expect(await drafts(services)).toEqual([]);

    await waitFor(
      () => {
        expect(screen.getByRole("status").textContent).toBe(DRAFT_SAVED);
      },
      { timeout: 3000 },
    );
    const [draft] = await drafts(services);
    expect(draft?.responses.good).toBe("half a thought");
    expect(draft?.status).toBe("draft");
    expect(DRAFT_SAVED).toBe("Saved on this device");
  });

  it("saves at once when the page is hidden", async () => {
    const services = await openCompose();
    await userEvent.type(first(), "before switching away");

    hidePage();

    await waitFor(async () => {
      expect((await drafts(services))[0]?.responses.good).toBe(
        "before switching away",
      );
    });
  });

  it("does not save just because the page became visible again", async () => {
    const services = await openCompose();
    await userEvent.type(first(), "x");

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(await drafts(services)).toEqual([]);
  });

  it("saves at once when the page is being closed", async () => {
    const services = await openCompose();
    await userEvent.type(first(), "before closing");

    window.dispatchEvent(new Event("pagehide"));

    await waitFor(async () => {
      expect((await drafts(services))[0]?.responses.good).toBe(
        "before closing",
      );
    });
  });

  it("saves when the screen is left for another", async () => {
    const services = await openCompose();
    await userEvent.type(first(), "before leaving");

    await userEvent.click(
      screen.getByRole("link", { name: "Back to your journal" }),
    );

    expect(
      (
        await within(
          await screen.findByRole("navigation", { name: "Draft" }),
        ).findByRole("link")
      ).textContent,
    ).toContain("Carry on with your draft");
    expect((await drafts(services))[0]?.responses.good).toBe("before leaving");
  });

  it("makes no draft from a blank form, and never says it saved one", async () => {
    const services = await openCompose();
    await userEvent.type(first(), "  ");

    hidePage();
    await waitFor(() => {
      expect(screen.queryByText("Saving…")).toBeNull();
    });

    expect(await services.records.list("journal-entry")).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
  });

  it("flushes the draft before the session drops its keys (AC-21, DEV-005)", async () => {
    const services = await openCompose();
    const order: string[] = [];
    const put = services.records.put.bind(services.records);
    services.records.put = (kind, record) => {
      order.push(`put ${record.status}: ${record.responses.good}`);
      return put(kind, record);
    };
    const lock = services.vault.lock.bind(services.vault);
    services.vault.lock = () => {
      order.push("keys dropped");
      lock();
    };
    await userEvent.type(first(), "half a thought");

    await lockNow(services, () => undefined);

    expect(order).toEqual(["put draft: half a thought", "keys dropped"]);
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("picks the stored draft up when the screen opens, with its feelings", async () => {
    const stored = entry(4, "2026-11-10", {
      status: "draft",
      responses: { good: "half a thought", improve: "", loved: "" },
      feelings: ["tired"],
    });
    const services = await openCompose(
      unlockedWith(entry(1, "2026-11-03"), stored),
    );

    expect(first()).toHaveProperty("value", "half a thought");
    expect(screen.getByLabelText("tired")).toHaveProperty("checked", true);
    expect(
      screen.getByText(/carrying on with the draft/).textContent,
    ).toContain(formatEntryDate(stored.entryDate));
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeTruthy();

    await userEvent.type(first(), " and more");
    hidePage();

    await waitFor(async () => {
      expect((await drafts(services))[0]?.responses.good).toBe(
        "half a thought and more",
      );
    });
    // The same entry was updated: no second draft, and its day is kept.
    const [draft, ...others] = await drafts(services);
    expect(others).toEqual([]);
    expect(draft?.id).toBe(stored.id);
    expect(draft?.createdAt).toBe(stored.createdAt);
    expect(draft?.entryDate).toEqual(stored.entryDate);
    expect(draft?.feelings).toEqual(["tired"]);
  });

  it("finishing turns the draft into the completed entry: same ID, no draft left", async () => {
    const stored = entry(4, "2026-11-10", {
      status: "draft",
      responses: { good: "One", improve: "Two", loved: "" },
    });
    const services = await openCompose(unlockedWith(stored));

    await userEvent.type(
      screen.getByLabelText(PROMPTS[2]?.label ?? ""),
      "Three",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${stored.id}`);
    });
    expect(await services.records.list("journal-entry")).toMatchObject([
      {
        id: stored.id,
        status: "complete",
        createdAt: stored.createdAt,
        responses: { good: "One", improve: "Two", loved: "Three" },
      },
    ]);
  });

  it("an unfinished draft cannot be finished, and stays a draft", async () => {
    const stored = entry(4, "2026-11-10", {
      status: "draft",
      responses: { good: "One", improve: "", loved: "" },
    });
    const services = await openCompose(unlockedWith(stored));

    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => {
      expect(screen.getAllByText(ANSWER_NEEDED)).toHaveLength(2);
    });
    expect((await drafts(services)).map((each) => each.id)).toEqual([
      stored.id,
    ]);
  });

  it("discards the draft only after confirmation, then starts empty", async () => {
    const stored = entry(4, "2026-11-10", {
      status: "draft",
      responses: { good: "half a thought", improve: "", loved: "" },
    });
    const services = await openCompose(unlockedWith(stored));

    await userEvent.click(
      screen.getByRole("button", { name: "Discard draft" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Discard this draft?",
    });
    expect(dialog.textContent).toContain("deleted for good");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Keep writing" }),
    );
    expect(await drafts(services)).toHaveLength(1);
    expect(first()).toHaveProperty("value", "half a thought");

    await userEvent.click(
      screen.getByRole("button", { name: "Discard draft" }),
    );
    await userEvent.click(
      within(
        screen.getByRole("alertdialog", { name: "Discard this draft?" }),
      ).getByRole("button", { name: "Discard draft" }),
    );

    await waitFor(() => {
      expect(first()).toHaveProperty("value", "");
    });
    expect(await services.records.list("journal-entry")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
    expect(screen.queryByText(/carrying on with the draft/)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("does not bring back text that was typed just before discarding", async () => {
    const services = await openCompose();
    await userEvent.type(first(), "soon gone");
    hidePage();
    await screen.findByRole("button", { name: "Discard draft" });
    await userEvent.type(first(), " and this");

    await userEvent.click(
      screen.getByRole("button", { name: "Discard draft" }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard draft",
      }),
    );
    await waitFor(() => {
      expect(first()).toHaveProperty("value", "");
    });
    await new Promise((resolve) =>
      setTimeout(resolve, AUTOSAVE_DELAY_MS + 200),
    );

    expect(await services.records.list("journal-entry")).toEqual([]);
  });

  it("says so, in words that say what to do, when the draft cannot be saved", async () => {
    const services = await openCompose();
    services.records.put = () => Promise.reject(new Error("synthetic"));
    await userEvent.type(first(), "x");

    hidePage();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(DRAFT_NOT_SAVED);
    });
    expect(DRAFT_NOT_SAVED).toContain("Keep this page open");
    expect(first()).toHaveProperty("value", "x");
  });

  it("shows that it is saving without reading that out", async () => {
    await openCompose();

    await userEvent.type(first(), "x");

    const saving = screen.getByText("Saving…");
    expect(saving.getAttribute("aria-hidden")).toBe("true");
    expect(saving.closest('[role="status"]')).toBeNull();
  });

  it("says so when the journal cannot be opened, and shows no form", async () => {
    const services = testServices("unlocked");
    services.records.list = () => Promise.reject(new Error("synthetic"));

    await renderApp("/journal/new", services);

    expect((await screen.findByRole("alert")).textContent).toContain(
      CANNOT_OPEN,
    );
    expect(screen.queryByRole("button", { name: "Save entry" })).toBeNull();
  });

  it("an entry being finished when the app locks is not stored as complete; the draft stays", async () => {
    const services = await openCompose();
    for (const prompt of PROMPTS) {
      await userEvent.type(screen.getByLabelText(prompt.label), "Private");
    }
    hidePage();
    await waitFor(async () => {
      expect(await drafts(services)).toHaveLength(1);
    });
    const puts: string[] = [];
    const put = services.records.put.bind(services.records);
    services.records.put = (kind, record) => {
      puts.push(record.status);
      return put(kind, record);
    };
    // Hold the hashing of the finished entry until the app has locked.
    let release: () => void = () => undefined;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const hashing = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(async (algorithm, data) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return digest(algorithm, data);
      });

    fireEvent.submit(
      screen.getByRole("button", { name: "Save entry" }).closest("form") ??
        document.body,
    );
    await waitFor(() => {
      expect(hashing).toHaveBeenCalled();
    });
    await lockNow(services, () => undefined);
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(puts).toEqual([]);
    expect(services.session.state).toBe("signed_in_locked");
  });

  it("text typed while the entry is being finished never becomes a second draft", async () => {
    const services = await openCompose();
    for (const prompt of PROMPTS) {
      await userEvent.type(screen.getByLabelText(prompt.label), "Answer");
    }
    hidePage();
    await waitFor(async () => {
      expect(await drafts(services)).toHaveLength(1);
    });
    // Hold the hashing of the finished entry, so typing lands in the middle.
    let release: () => void = () => undefined;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const hashing = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(async (algorithm, data) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return digest(algorithm, data);
      });

    fireEvent.submit(
      screen.getByRole("button", { name: "Save entry" }).closest("form") ??
        document.body,
    );
    await waitFor(() => {
      expect(hashing).toHaveBeenCalled();
    });
    fireEvent.input(first(), { target: { value: "Answer and a late word" } });
    release();
    await waitFor(() => {
      expect(window.location.pathname).toMatch(/^\/journal\/entries\//);
    });
    vi.restoreAllMocks();
    await new Promise((resolve) =>
      setTimeout(resolve, AUTOSAVE_DELAY_MS + 200),
    );

    const stored = await services.records.list("journal-entry");
    expect(stored.map((each) => each.status)).toEqual(["complete"]);
  });

  it("saves drafts again after finishing failed", async () => {
    const services = await openCompose();
    for (const prompt of PROMPTS) {
      await userEvent.type(screen.getByLabelText(prompt.label), "Answer");
    }
    const put = services.records.put.bind(services.records);
    services.records.put = (kind, record) =>
      record.status === "complete"
        ? Promise.reject(new Error("synthetic"))
        : put(kind, record);

    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't continue",
    );
    await userEvent.type(first(), " still here");
    hidePage();

    await waitFor(async () => {
      expect((await drafts(services))[0]?.responses.good).toBe(
        "Answer still here",
      );
    });
    expect(await drafts(services)).toHaveLength(1);
  });

  it("flushes the draft before a removed device drops its keys, and stores nothing after (DEV-003)", async () => {
    const services = await openCompose();
    const order: string[] = [];
    const put = services.records.put.bind(services.records);
    services.records.put = (kind, record) => {
      order.push(`put ${record.status}: ${record.responses.good}`);
      return put(kind, record);
    };
    const lock = services.vault.lock.bind(services.vault);
    services.vault.lock = () => {
      order.push("keys dropped");
      lock();
    };
    await userEvent.type(first(), "half a thought");

    await endRevokedDevice(services, () => undefined);
    await new Promise((resolve) =>
      setTimeout(resolve, AUTOSAVE_DELAY_MS + 200),
    );

    expect(order).toEqual(["put draft: half a thought", "keys dropped"]);
    expect(services.session.state).toBe("signed_out");
  });

  it("a draft's page offers to carry on writing; a finished entry's does not", async () => {
    const draft = entry(4, "2026-11-10", { status: "draft" });
    const services = await unlockedWith(draft, entry(1, "2026-11-03"));
    await renderApp(`/journal/entries/${draft.id}`, services);

    expect(
      (
        await screen.findByRole("link", { name: "Carry on writing" })
      ).getAttribute("href"),
    ).toBe("/journal/new");

    cleanup();
    await renderApp(
      "/journal/entries/00000000-0000-4000-8000-0000000000a1",
      services,
    );
    await screen.findByText("Good 1");
    expect(screen.queryByRole("link", { name: "Carry on writing" })).toBeNull();
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
