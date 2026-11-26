import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainEvents } from "../../../src/domain/events";
import { PROMPTS, type JournalEntry } from "../../../src/domain/journal/types";
import { ANSWER_NEEDED } from "../../../src/domain/journal/validation";
import { StaleRecordError } from "../../../src/storage/record-store";
import {
  CHANGES_BROUGHT_BACK,
  CHANGES_KEPT,
  CHANGES_NOT_KEPT,
  ENTRY_CHANGED_SINCE,
} from "../../../src/ui/screens/journal/EditEntry";
import { DELETE_WARNING } from "../../../src/ui/screens/journal/shared";
import {
  CANNOT_OPEN,
  formatEntryDate,
  inTimelineOrder,
} from "../../../src/ui/screens/journal/shared";

import {
  heading,
  onEntryPut,
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
      screen.getByRole("button", { name: "Cancel and go back to the entry" }),
    ).toBeTruthy();
    expect(screen.queryByText(CHANGES_BROUGHT_BACK)).toBeNull();
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

describe("changes to an entry that were not saved (JR-006, DEV-005; ADR-0015)", () => {
  const status = (): string =>
    within(screen.getByRole("main")).getByRole("status").textContent;

  /** Open the edit screen again, as after a lock or a reload. */
  async function reopen(services: TestServices): Promise<void> {
    cleanup();
    await renderApp(`/journal/entries/${ID}/edit`, services);
    await screen.findByRole("button", { name: "Save changes" });
  }

  it("are kept before the app locks, apart from the entry, which is not changed", async () => {
    const { services, heard } = await openEdit();
    expect(status()).toBe("");

    await userEvent.type(box(0), " and more");
    await services.lockHooks.flush();

    expect(await services.records.unfinished(ID)).toEqual({
      responses: {
        good: "Good one and more",
        improve: "Improve one",
        loved: "Loved one",
      },
      feelings: ["calm"],
      basedOn: "0".repeat(64),
    });
    expect(await services.records.get("journal-entry", ID)).toEqual(stored());
    expect(await services.records.list("journal-entry")).toHaveLength(1);
    expect(heard).toEqual([]);
    await waitFor(() => {
      expect(status()).toBe(CHANGES_KEPT);
    });
  });

  it("are kept when the page is hidden, when it is closed, and when the screen is left", async () => {
    const leave: (() => void | Promise<void>)[] = [
      () => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      },
      () => {
        window.dispatchEvent(new Event("pagehide"));
      },
      () => userEvent.click(screen.getByRole("link", { name: "Settings" })),
    ];
    for (const how of leave) {
      cleanup();
      const { services } = await openEdit();
      await userEvent.type(box(0), " and more");

      await how();

      await waitFor(async () => {
        expect((await services.records.unfinished(ID))?.responses.good).toBe(
          "Good one and more",
        );
      });
      expect(await services.records.get("journal-entry", ID)).toEqual(stored());
      vi.restoreAllMocks();
    }
  });

  it("are put back on the form when the entry is next edited, and the page says what they are", async () => {
    const { services } = await openEdit();
    await userEvent.type(box(0), " and more");
    await userEvent.click(screen.getByLabelText("sad"));
    await services.lockHooks.flush();

    await reopen(services);

    expect(box(0)).toHaveProperty("value", "Good one and more");
    expect(screen.getByLabelText("sad")).toHaveProperty("checked", true);
    const notice = screen
      .getByText(new RegExp(CHANGES_BROUGHT_BACK.slice(0, 40)))
      .closest('[role="status"]');
    expect(notice?.textContent).toContain(CHANGES_BROUGHT_BACK);
    expect(notice?.textContent).not.toContain(ENTRY_CHANGED_SINCE);
    // Offering them has changed nothing.
    expect(await services.records.get("journal-entry", ID)).toEqual(stored());
  });

  it("are offered even when the screen is opened again before they have reached storage", async () => {
    const { services } = await openEdit();
    // Keeping is slow: it goes ahead only when the test says.
    const keep = services.records.keepUnfinished.bind(services.records);
    let go: () => void = () => undefined;
    const told = new Promise<void>((resolve) => {
      go = resolve;
    });
    services.records.keepUnfinished = async (...args) => {
      await told;
      return keep(...args);
    };
    await userEvent.type(box(0), " and more");

    // Left, and opened again at once.
    cleanup();
    await renderApp(`/journal/entries/${ID}/edit`, services);
    // Everything that can happen without the keeping has happened: the
    // form is not shown from the entry alone meanwhile.
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByText("Getting your entry.")).toBeTruthy();
    go();

    await screen.findByRole("button", { name: "Save changes" });
    expect(box(0)).toHaveProperty("value", "Good one and more");
  });

  it("say so when the entry has been changed since they were typed, and replace it only when saved", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", stored());
    await services.records.keepUnfinished(ID, {
      responses: { good: "Typed before", improve: "i", loved: "l" },
      feelings: [],
      basedOn: "1".repeat(64),
    });

    await renderApp(`/journal/entries/${ID}/edit`, services);

    expect(
      (await screen.findByText(new RegExp(ENTRY_CHANGED_SINCE))).textContent,
    ).toContain(CHANGES_BROUGHT_BACK);
    expect(box(0)).toHaveProperty("value", "Typed before");
    expect(await services.records.get("journal-entry", ID)).toEqual(stored());

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
    });
    expect(
      (await services.records.get("journal-entry", ID))?.responses.good,
    ).toBe("Typed before");
    expect(await services.records.unfinished(ID)).toBeUndefined();
  });

  it("are removed once the entry is saved, and are not offered again", async () => {
    const { services } = await openEdit();
    await userEvent.type(box(0), " and more");
    await services.lockHooks.flush();

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
    });

    expect(await services.records.unfinished(ID)).toBeUndefined();
    await reopen(services);
    expect(screen.queryByText(new RegExp(CHANGES_BROUGHT_BACK))).toBeNull();
    expect(box(0)).toHaveProperty("value", "Good one and more");
  });

  it("are removed by Cancel, which leaves the entry as it was", async () => {
    const { services } = await openEdit();
    await userEvent.type(box(0), " and more");
    await services.lockHooks.flush();

    await userEvent.click(
      screen.getByRole("button", { name: "Cancel and go back to the entry" }),
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
    });
    // Nothing waiting to be kept is kept after cancelling, either.
    await services.lockHooks.flush();
    expect(await services.records.unfinished(ID)).toBeUndefined();
    expect(await services.records.get("journal-entry", ID)).toEqual(stored());
  });

  it("can be given up for the saved entry from the notice", async () => {
    const { services } = await openEdit();
    await userEvent.type(box(0), " and more");
    await services.lockHooks.flush();
    await reopen(services);

    await userEvent.click(
      screen.getByRole("button", { name: "Start again from the saved entry" }),
    );

    await waitFor(() => {
      expect(box(0)).toHaveProperty("value", "Good one");
    });
    expect(screen.queryByText(new RegExp(CHANGES_BROUGHT_BACK))).toBeNull();
    expect(await services.records.unfinished(ID)).toBeUndefined();
    expect(await services.records.get("journal-entry", ID)).toEqual(stored());
  });

  it("are removed when the form is typed back to what the entry says", async () => {
    const { services } = await openEdit();
    await userEvent.type(box(0), "!");
    await services.lockHooks.flush();
    expect(await services.records.unfinished(ID)).toBeDefined();

    await userEvent.type(box(0), "{Backspace}");

    await waitFor(async () => {
      expect(await services.records.unfinished(ID)).toBeUndefined();
    });
    await waitFor(() => {
      expect(status()).toBe("");
    });
  });

  it("are not offered, and are removed, when they say what the entry already says", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", stored());
    await services.records.keepUnfinished(ID, {
      responses: stored().responses,
      feelings: ["calm"],
      basedOn: "1".repeat(64),
    });

    await renderApp(`/journal/entries/${ID}/edit`, services);
    await screen.findByRole("button", { name: "Save changes" });

    expect(screen.queryByText(new RegExp(CHANGES_BROUGHT_BACK))).toBeNull();
    await waitFor(async () => {
      expect(await services.records.unfinished(ID)).toBeUndefined();
    });
  });

  it("typed while the entry is being saved are not kept once it is saved", async () => {
    const { services } = await openEdit();
    let go: () => void = () => undefined;
    const told = new Promise<void>((resolve) => {
      go = resolve;
    });
    onEntryPut(services.records, async (_entry, put) => {
      await told;
      await put();
    });

    await userEvent.type(box(0), " and more");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.type(box(0), " late");
    go();

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/journal/entries/${ID}`);
    });
    await services.lockHooks.flush();
    expect(await services.records.unfinished(ID)).toBeUndefined();
  });

  it("say so when they cannot be kept, and stay on the page", async () => {
    const { services } = await openEdit();
    services.records.keepUnfinished = () =>
      Promise.reject(new Error("synthetic"));

    await userEvent.type(box(0), " and more");
    await services.lockHooks.flush();

    await waitFor(() => {
      expect(status()).toBe(CHANGES_NOT_KEPT);
    });
    expect(box(0)).toHaveProperty("value", "Good one and more");
    expect(CHANGES_NOT_KEPT).toContain("still on this page");
  });

  it("do not stop the entry from being edited when they cannot be read", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", stored());
    services.records.unfinished = () => Promise.reject(new Error("synthetic"));

    await renderApp(`/journal/entries/${ID}/edit`, services);
    await screen.findByRole("button", { name: "Save changes" });

    expect(box(0)).toHaveProperty("value", "Good one");
    expect(screen.queryByRole("alert")).toBeNull();
  });
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
    // What was typed was not saved as the entry, so it is still kept.
    await services.lockHooks.flush();
    expect((await services.records.unfinished(ID))?.responses.good).toBe(
      "Good one mine",
    );
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
    // Loading the latest version gave up what was typed, as the notice said.
    await services.lockHooks.flush();
    expect(await services.records.unfinished(ID)).toBeUndefined();

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
