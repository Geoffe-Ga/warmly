/**
 * What the person sees when this device's storage fails, or the network is
 * off (PRD AC-28, UI-008, SYNC-001). Every case injects the failure and
 * checks that what was typed is still on the screen.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OFFLINE_LOCKED, OFFLINE_UNLOCKED } from "../../../src/app/App";
import { PROMPTS, type JournalEntry } from "../../../src/domain/journal/types";
import {
  NewerDatabaseError,
  StorageBlockedError,
  StorageFullError,
  StorageUnavailableError,
  type StorageError,
} from "../../../src/storage/errors";
import type { Persistence } from "../../../src/storage/persistence";
import { STORAGE_KEPT } from "../../../src/ui/screens/Settings";
import {
  CANNOT_OPEN,
  describeStorageError,
} from "../../../src/ui/storage-messages";

import { renderApp, testServices, type TestServices } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FAILURES: readonly (readonly [string, () => StorageError])[] = [
  ["a full device", () => new StorageFullError()],
  ["storage the browser won't allow", () => new StorageUnavailableError()],
  ["another tab in the way", () => new StorageBlockedError()],
  ["a newer version's database", () => new NewerDatabaseError()],
];

const ID = "00000000-0000-4000-8000-0000000000f1";

function stored(): JournalEntry {
  return {
    id: ID,
    createdAt: "2026-11-03T10:00:00.000Z",
    entryDate: { date: "2026-11-03", timeZone: "UTC" },
    updatedAt: "2026-11-03T10:00:00.000Z",
    status: "complete",
    responses: { good: "Good one", improve: "Improve one", loved: "Loved one" },
    contentHash: "0".repeat(64),
  };
}

const box = (index: number): HTMLElement =>
  screen.getByLabelText(PROMPTS[index]?.label ?? "");

function hidePage(): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
}

async function openCompose(): Promise<TestServices> {
  const services = await renderApp("/journal/new", testServices("unlocked"));
  await screen.findByRole("button", { name: "Save entry" });
  return services;
}

describe("saving when storage fails (AC-28)", () => {
  it.each(FAILURES)(
    "finishing an entry with %s: the text stays, and the alert says what to do",
    async (_name, make) => {
      const services = await openCompose();
      const error = make();
      services.records.put = () => Promise.reject(error);
      for (const [index] of PROMPTS.entries()) {
        await userEvent.type(box(index), `what I typed ${String(index)}`);
      }

      await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/couldn't save/i);
      expect(alert.textContent).toContain(describeStorageError(error, "save"));
      for (const [index] of PROMPTS.entries()) {
        expect(box(index)).toHaveProperty(
          "value",
          `what I typed ${String(index)}`,
        );
      }
      expect(window.location.pathname).toBe("/journal/new");
      expect(await services.records.list("journal-entry")).toEqual([]);
    },
  );

  it.each(FAILURES)(
    "autosaving a draft with %s: the text stays, and the status says what to do",
    async (_name, make) => {
      const services = await openCompose();
      const error = make();
      services.records.put = () => Promise.reject(error);
      await userEvent.type(box(0), "what I typed");

      hidePage();

      await waitFor(() => {
        expect(
          within(screen.getByRole("main")).getByRole("status").textContent,
        ).toBe(describeStorageError(error, "save"));
      });
      expect(box(0)).toHaveProperty("value", "what I typed");
      // It is not mistaken for a change made in another tab.
      expect(screen.queryByText(/was changed in another tab/)).toBeNull();
    },
  );

  it("saves the draft once storage works again, without the text being retyped", async () => {
    const services = await openCompose();
    const put = services.records.put.bind(services.records);
    services.records.put = () => Promise.reject(new StorageFullError());
    await userEvent.type(box(0), "what I typed");
    hidePage();
    await waitFor(() => {
      expect(
        within(screen.getByRole("main")).getByRole("status").textContent,
      ).toMatch(/no room left/);
    });

    services.records.put = put;
    await userEvent.type(box(0), "!");
    hidePage();

    await waitFor(async () => {
      expect(
        (await services.records.list("journal-entry"))[0]?.responses.good,
      ).toBe("what I typed!");
    });
    expect(
      within(screen.getByRole("main")).getByRole("status").textContent,
    ).toBe("Saved on this device");
  });

  it.each(FAILURES)(
    "editing an entry with %s: the text stays, and the alert says what to do",
    async (_name, make) => {
      const services = testServices("unlocked");
      await services.records.put("journal-entry", stored());
      await renderApp(`/journal/entries/${ID}/edit`, services);
      await screen.findByRole("button", { name: "Save changes" });
      const error = make();
      services.records.put = () => Promise.reject(error);

      await userEvent.type(box(0), " and what I typed");
      await userEvent.click(
        screen.getByRole("button", { name: "Save changes" }),
      );

      expect((await screen.findByRole("alert")).textContent).toContain(
        describeStorageError(error, "save"),
      );
      expect(box(0)).toHaveProperty("value", "Good one and what I typed");
      expect(window.location.pathname).toBe(`/journal/entries/${ID}/edit`);
    },
  );

  it("deleting with a full device: says so in storage words and keeps the entry", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", stored());
    await renderApp(`/journal/entries/${ID}`, services);
    await screen.findByText("Good one");
    services.records.delete = () => Promise.reject(new StorageFullError());

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this entry" }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete entry",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /no room left/,
    );
    expect(screen.getByText("Good one")).toBeTruthy();
  });
});

describe("opening the journal when storage fails (AC-28, §13.6)", () => {
  const SCREENS = [
    "/journal",
    "/journal/new",
    `/journal/entries/${ID}`,
    `/journal/entries/${ID}/edit`,
  ];

  it.each(FAILURES)(
    "with %s, every journal screen says why and what to do, and shows no form",
    async (_name, make) => {
      const error = make();
      for (const path of SCREENS) {
        cleanup();
        const services = testServices("unlocked");
        services.records.list = () => Promise.reject(error);
        services.records.get = () => Promise.reject(error);

        await renderApp(path, services);

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain(
          describeStorageError(error, "open"),
        );
        expect(alert.textContent).toContain(
          "Nothing has been changed or deleted.",
        );
        expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
      }
    },
  );

  it("falls back to the general message for a failure it does not recognise, without showing its text", async () => {
    const services = testServices("unlocked");
    services.records.list = () =>
      Promise.reject(new Error("synthetic private detail"));

    await renderApp("/journal", services);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(CANNOT_OPEN);
    expect(alert.textContent).not.toContain("synthetic private detail");
  });
});

describe("the offline notice (UI-008, AC-28)", () => {
  function setOnline(online: boolean): void {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  }

  const notice = (): Element | null =>
    document.querySelector(".offline-notice");

  it("is in the page but empty while online", async () => {
    await renderApp("/", testServices("unlocked"));

    expect(notice()?.getAttribute("role")).toBe("status");
    expect(notice()?.textContent).toBe("");
  });

  it("says the writing is saved on this device when the connection drops, and clears when it returns", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", stored());
    await renderApp("/journal", services);
    await screen.findByRole("navigation", { name: "Entries" });

    setOnline(false);
    await waitFor(() => {
      expect(notice()?.textContent).toBe(OFFLINE_UNLOCKED);
    });
    expect(OFFLINE_UNLOCKED).toBe(
      "Offline: your writing is saved on this device.",
    );
    // The notice never carries anything that was written.
    expect(notice()?.textContent).not.toContain("Good one");

    setOnline(true);
    await waitFor(() => {
      expect(notice()?.textContent).toBe("");
    });
  });

  it("starts with the notice when the app is opened offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await renderApp("/", testServices("unlocked"));

    expect(notice()?.textContent).toBe(OFFLINE_UNLOCKED);
  });

  it.each(["signed_out", "signed_in_locked"] as const)(
    "while %s, says what still works offline and promises nothing about writing",
    async (state) => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      await renderApp("/", testServices(state));

      expect(notice()?.textContent).toBe(OFFLINE_LOCKED);
      expect(OFFLINE_LOCKED).toContain("Signing in needs a connection.");
    },
  );
});

describe("Settings says whether the browser will keep the data (AC-28)", () => {
  it.each(["persistent", "best-effort", "unsupported"] as const)(
    "when the browser reports %s",
    async (state: Persistence) => {
      const services = testServices("unlocked");
      services.persistence.state = () => Promise.resolve(state);

      await renderApp("/settings", services);

      const line = await screen.findByTestId("storage-persistence");
      expect(line.textContent).toBe(STORAGE_KEPT[state]);
      expect(line.closest("section")?.querySelector("h2")?.textContent).toBe(
        "Storage on this device",
      );
    },
  );

  it("promises to keep the data only when the browser has agreed to", () => {
    expect(STORAGE_KEPT.persistent).toContain("has agreed to keep");
    expect(STORAGE_KEPT["best-effort"]).toContain("may clear");
    expect(STORAGE_KEPT.unsupported).toContain("may clear");
    expect(STORAGE_KEPT["best-effort"]).not.toContain("agreed");
    expect(STORAGE_KEPT.unsupported).not.toContain("agreed");
  });
});
