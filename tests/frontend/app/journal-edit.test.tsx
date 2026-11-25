import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DomainEvents } from "../../../src/domain/events";
import { PROMPTS, type JournalEntry } from "../../../src/domain/journal/types";
import { ANSWER_NEEDED } from "../../../src/domain/journal/validation";
import { StaleRecordError } from "../../../src/storage/record-store";
import { DELETE_WARNING } from "../../../src/ui/screens/journal/Entry";
import {
  CANNOT_OPEN,
  formatEntryDate,
  inTimelineOrder,
} from "../../../src/ui/screens/journal/shared";

import {
  heading,
  onEntryReload,
  renderApp,
  testServices,
  type TestServices,
} from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

const ID = "00000000-0000-4000-8000-0000000000e1";

function stored(changes: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: ID,
    createdAt: "2026-11-03T10:00:00.000Z",
    entryDate: { date: "2026-11-03", timeZone: "UTC" },
    updatedAt: "2026-11-03T10:00:00.000Z",
    status: "complete",
    responses: { good: "Good one", improve: "Improve one", loved: "Loved one" },
    feelings: ["calm"],
    contentHash: "0".repeat(64),
    ...changes,
  };
}

/** Open the edit screen for a stored entry, with a record of events. */
async function openEdit(entry: JournalEntry = stored()): Promise<{
  services: TestServices;
  heard: DomainEvents["journal.changed"][];
}> {
  const services = testServices("unlocked");
  await services.records.put("journal-entry", entry);
  const heard: DomainEvents["journal.changed"][] = [];
  services.events.on("journal.changed", (event) => {
    heard.push(event);
  });
  await renderApp(`/journal/entries/${entry.id}/edit`, services);
  await screen.findByRole("button", { name: "Save changes" });
  return { services, heard };
}

const box = (index: number): HTMLElement =>
  screen.getByLabelText(PROMPTS[index]?.label ?? "");

describe("editing a saved entry (JR-006, AC-06)", () => {
  it("is reached from the entry's page", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", stored());
    await renderApp(`/journal/entries/${ID}`, services);

    const link = await screen.findByRole("link", { name: "Edit this entry" });
    expect(link.getAttribute("href")).toBe(`/journal/entries/${ID}/edit`);
    await userEvent.click(link);

    expect(
      await screen.findByRole("button", { name: "Save changes" }),
    ).toBeTruthy();
    expect(heading().textContent).toBe("Edit journal entry");
  });

  it("starts with what the entry says, its feelings and its date", async () => {
    await openEdit();

    expect(box(0)).toHaveProperty("value", "Good one");
    expect(box(1)).toHaveProperty("value", "Improve one");
    expect(box(2)).toHaveProperty("value", "Loved one");
    expect(screen.getByLabelText("calm")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("sad")).toHaveProperty("checked", false);
    expect(
      screen.getByText(
        `Your entry from ${formatEntryDate({ date: "2026-11-03", timeZone: "UTC" })}.`,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/there is no undo/).textContent).toContain(
      "The earlier wording is not kept",
    );
    expect(
      screen
        .getByRole("link", { name: "Cancel and go back to the entry" })
        .getAttribute("href"),
    ).toBe(`/journal/entries/${ID}`);
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
  });

  it("saves the new wording over the old, keeps the date, announces the change and shows the entry", async () => {
    const { services, heard } = await openEdit();

    await userEvent.clear(box(0));
    await userEvent.type(box(0), "Rewritten");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
    });
    const all = await services.records.list("journal-entry");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: ID,
      status: "complete",
      createdAt: "2026-11-03T10:00:00.000Z",
      entryDate: { date: "2026-11-03", timeZone: "UTC" },
      responses: {
        good: "Rewritten",
        improve: "Improve one",
        loved: "Loved one",
      },
      feelings: ["calm"],
    });
    expect(all[0]?.updatedAt).not.toBe("2026-11-03T10:00:00.000Z");
    expect(JSON.stringify(all)).not.toContain("Good one");
    expect(heard).toEqual([
      {
        entryId: ID,
        oldHash: "0".repeat(64),
        newHash: all[0]?.contentHash,
      },
    ]);
    expect(await screen.findByText("Rewritten")).toBeTruthy();
    expect(heading().textContent).toBe(
      formatEntryDate({ date: "2026-11-03", timeZone: "UTC" }),
    );
  });

  it("shows the saved entry, not an error, when only a listener to the event fails", async () => {
    const { services } = await openEdit();
    services.events.on("journal.changed", () => {
      throw new Error("synthetic listener failure");
    });

    await userEvent.type(box(0), " and more");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (await services.records.get("journal-entry", ID))?.responses.good,
    ).toBe("Good one and more");
  });

  it("saves nothing while an answer is blank, and says so on that field (JR-002)", async () => {
    const { services, heard } = await openEdit();

    await userEvent.clear(box(1));
    await userEvent.type(box(1), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(box(1).getAttribute("aria-invalid")).toBe("true");
    });
    expect(
      (box(1).getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent),
    ).toContain(ANSWER_NEEDED);
    await waitFor(() => {
      expect(document.activeElement).toBe(box(1));
    });
    expect(await services.records.get("journal-entry", ID)).toEqual(stored());
    expect(heard).toEqual([]);
    expect(window.location.pathname).toBe(`/journal/entries/${ID}/edit`);
  });

  it("says so when there is no finished entry to edit: an unknown ID or a draft", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", stored({ status: "draft" }));

    for (const id of [ID, "00000000-0000-4000-8000-0000000000ff"]) {
      cleanup();
      await renderApp(`/journal/entries/${id}/edit`, services);
      expect(
        await screen.findByText(/There is no finished entry here to edit/),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
      expect(screen.queryByText("Good one")).toBeNull();
    }
  });

  it("says so when the journal cannot be opened", async () => {
    const services = testServices("unlocked");
    services.records.get = () => Promise.reject(new Error("synthetic"));

    await renderApp(`/journal/entries/${ID}/edit`, services);

    expect((await screen.findByRole("alert")).textContent).toContain(
      CANNOT_OPEN,
    );
  });

  it("says so when saving fails, and keeps what was typed", async () => {
    const { services } = await openEdit();
    services.records.put = () => Promise.reject(new Error("synthetic"));

    await userEvent.type(box(0), " and more");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't continue",
    );
    expect(box(0)).toHaveProperty("value", "Good one and more");
    expect(window.location.pathname).toBe(`/journal/entries/${ID}/edit`);
  });

  it.each(["signed_out", "signed_in_locked"] as const)(
    "is not shown while %s",
    async (state) => {
      const services = testServices(state);
      await services.records.put("journal-entry", stored());

      await renderApp(`/journal/entries/${ID}/edit`, services);

      expect(screen.queryByText("Good one")).toBeNull();
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    },
  );
});

describe("an entry changed in another tab (invariant 5)", () => {
  it("is not saved over: the screen says so and offers the latest version, which can then be edited", async () => {
    const { services, heard } = await openEdit();
    const newer = stored({
      responses: { good: "From the other tab", improve: "i", loved: "l" },
      updatedAt: "2026-11-04T10:00:00.000Z",
    });
    const put = services.records.put.bind(services.records);
    services.records.put = () => Promise.reject(new StaleRecordError());
    onEntryReload(services.records, async () => {
      await put("journal-entry", newer);
      return newer;
    });

    await userEvent.type(box(0), " mine");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const banner = (
      await screen.findByText(/was changed in another tab or window/)
    ).closest('[role="status"]');
    expect(banner?.textContent).toContain("This entry");
    expect(banner?.textContent).toContain("Copy anything you want to keep");
    expect(box(0)).toHaveProperty("value", "Good one mine");
    expect(heard).toEqual([]);
    expect(window.location.pathname).toBe(`/journal/entries/${ID}/edit`);

    services.records.put = put;
    await userEvent.click(
      within(banner as HTMLElement).getByRole("button", {
        name: "Load the latest version",
      }),
    );

    await waitFor(() => {
      expect(box(0)).toHaveProperty("value", "From the other tab");
    });
    expect(screen.queryByText(/was changed in another tab/)).toBeNull();

    await userEvent.type(box(0), ", and mine");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
    });
    expect(
      (await services.records.get("journal-entry", ID))?.responses.good,
    ).toBe("From the other tab, and mine");
  });

  it("says there is nothing left to edit when the other tab deleted the entry", async () => {
    const { services } = await openEdit();
    services.records.put = () => Promise.reject(new StaleRecordError());
    services.records.reload = () => Promise.resolve(undefined);

    await userEvent.type(box(0), " mine");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Load the latest version" }),
    );

    expect(
      await screen.findByText(/There is no finished entry here to edit/),
    ).toBeTruthy();
  });
});

describe("the timeline's order (JR-005)", () => {
  it("is the same every time for entries created at the same instant", () => {
    const a = stored({ id: "a" });
    const b = stored({ id: "b" });
    const c = stored({ id: "c" });

    expect(inTimelineOrder([c, a, b]).map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(inTimelineOrder([b, c, a]).map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("deleting an entry (JR-007, OPS-003)", () => {
  async function openEntry(entry: JournalEntry = stored()): Promise<{
    services: TestServices;
    heard: DomainEvents["journal.deleted"][];
  }> {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", entry);
    await services.records.put(
      "journal-entry",
      stored({
        id: "00000000-0000-4000-8000-0000000000e2",
        entryDate: { date: "2026-10-01", timeZone: "UTC" },
        responses: { good: "Kept one", improve: "k", loved: "k" },
      }),
    );
    const heard: DomainEvents["journal.deleted"][] = [];
    services.events.on("journal.deleted", (event) => {
      heard.push(event);
    });
    await renderApp(`/journal/entries/${entry.id}`, services);
    await screen.findByText("Good one");
    return { services, heard };
  }

  it("asks first, saying exactly what deleting does and does not remove", async () => {
    const { services, heard } = await openEntry();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this entry" }),
    );

    const dialog = screen.getByRole("alertdialog", {
      name: "Delete this entry for good?",
    });
    expect(dialog.textContent).toContain(DELETE_WARNING);
    expect(DELETE_WARNING).toContain("from this device now");
    expect(DELETE_WARNING).toContain("the next time they sync");
    expect(DELETE_WARNING).toContain("no trash and no undo");
    expect(DELETE_WARNING).toContain("within 30 days");
    // Nothing has happened yet.
    expect(await services.records.get("journal-entry", ID)).toEqual(stored());
    expect(heard).toEqual([]);
  });

  it("keeps the entry when the person backs out, by the button or by Escape", async () => {
    const { services, heard } = await openEntry();
    const open = screen.getByRole("button", { name: "Delete this entry" });

    await userEvent.click(open);
    await userEvent.click(
      screen.getByRole("button", { name: "Keep this entry" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(open);

    await userEvent.click(open);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();

    expect(await services.records.get("journal-entry", ID)).toEqual(stored());
    expect(heard).toEqual([]);
    expect(screen.getByText("Good one")).toBeTruthy();
  });

  it("deletes after confirmation, says so without blame, moves focus to the heading and announces it", async () => {
    const { services, heard } = await openEntry();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this entry" }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete entry",
      }),
    );

    await waitFor(() => {
      expect(heading().textContent).toBe("Entry deleted");
    });
    expect(document.activeElement).toBe(heading());
    const status = within(screen.getByRole("main")).getByRole("status");
    expect(status.textContent).toContain("Deleted");
    expect(status.textContent).toContain(
      "It has been removed from this device.",
    );
    expect(screen.queryByText("Good one")).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit this entry" })).toBeNull();
    expect(await services.records.get("journal-entry", ID)).toBeUndefined();
    expect(heard).toEqual([{ entryId: ID, oldHash: "0".repeat(64) }]);
    expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
  });

  it("says the entry was deleted, not that deleting failed, when only a listener to the event fails", async () => {
    const { services } = await openEntry();
    services.events.on("journal.deleted", () => {
      throw new Error("synthetic listener failure");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this entry" }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete entry",
      }),
    );

    await waitFor(() => {
      expect(heading().textContent).toBe("Entry deleted");
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Good one")).toBeNull();
    expect(await services.records.get("journal-entry", ID)).toBeUndefined();
  });

  it("never shows a deleted entry in the timeline or in search", async () => {
    await openEntry();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete this entry" }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete entry",
      }),
    );
    await screen.findByText("It has been removed from this device.");

    await userEvent.click(
      screen.getByRole("link", { name: "Back to your journal" }),
    );

    const links = within(
      await screen.findByRole("navigation", { name: "Entries" }),
    ).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      formatEntryDate({ date: "2026-10-01", timeZone: "UTC" }),
    ]);
    await userEvent.type(
      screen.getByLabelText("Search your journal"),
      "Good one",
    );
    expect(await screen.findByText("No entry mentions that.")).toBeTruthy();
  });

  it("says so and keeps the entry when deleting fails", async () => {
    const { services, heard } = await openEntry();
    services.records.delete = () => Promise.reject(new Error("synthetic"));

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this entry" }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete entry",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't delete",
    );
    expect(screen.getByText("Good one")).toBeTruthy();
    expect(heading().textContent).not.toBe("Entry deleted");
    expect(heard).toEqual([]);
  });

  it("deletes a draft the same way, in the draft's own words, announcing nothing", async () => {
    const { services, heard } = await openEntry(stored({ status: "draft" }));

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this draft" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete this draft for good?",
    });
    expect(
      within(dialog).getByRole("button", { name: "Keep this draft" }),
    ).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete draft" }),
    );

    await waitFor(() => {
      expect(heading().textContent).toBe("Entry deleted");
    });
    expect(await services.records.get("journal-entry", ID)).toBeUndefined();
    expect(heard).toEqual([]);
  });
});
