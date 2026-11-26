/**
 * Saying, before an entry is changed or deleted, that reflections built
 * from it will be removed (PRD DEP-003; invariant 6).
 */
import { cleanup, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removedText } from "../../../src/app/App";
import { pathFor } from "../../../src/app/routes";
import { newEntry } from "../../../src/domain/journal/types";
import { dependentsWarning } from "../../../src/ui/screens/journal/dependents";
import { renderApp, testServices, visit } from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

async function setUp(reflections: number) {
  const services = testServices("unlocked");
  const entry = await newEntry({
    good: "We cooked dinner together.",
    improve: "Synthetic two",
    loved: "Synthetic three",
  });
  await services.records.put("journal-entry", entry);
  for (let made = 0; made < reflections; made += 1) {
    await services.reflect.start({
      question: `CANARY question ${String(made)}?`,
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
  return { services, entry };
}

describe("the warning's words", () => {
  it("says nothing when no reflection was built from the entry", () => {
    expect(dependentsWarning(0, "edit")).toBeUndefined();
    expect(dependentsWarning(0, "delete")).toBeUndefined();
  });

  it("says how many, what will happen and why, for an edit and for a deletion", () => {
    expect(dependentsWarning(1, "edit")).toBe(
      "1 reflection was built from this entry. It will be removed if you change the words of your answers, because an answer may repeat what the entry said. Nothing is sent anywhere and nothing is written again.",
    );
    expect(dependentsWarning(1200, "delete")).toBe(
      "1,200 reflections were built from this entry. They will be removed when you delete it, because an answer may repeat what the entry said. Nothing is sent anywhere and nothing is written again.",
    );
  });
});

describe("on the screens (DEP-003)", () => {
  it("the edit screen warns, and saving a change removes the reflections and says so", async () => {
    const { services, entry } = await setUp(2);
    await renderApp(pathFor("journal-edit", { id: entry.id }), services);
    const user = userEvent.setup();

    expect(
      await screen.findByText(dependentsWarning(2, "edit") ?? ""),
    ).toBeTruthy();
    const box = screen.getByLabelText("What's going well?");
    await user.clear(box);
    await user.type(box, "Something else.");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(removedText(2))).toBeTruthy();
    expect(await services.reflect.list()).toEqual([]);
    expect(document.body.textContent).not.toContain("CANARY");
  });

  it("the edit screen says nothing of it when no reflection depends on the entry", async () => {
    const { services, entry } = await setUp(0);
    await renderApp(pathFor("journal-edit", { id: entry.id }), services);

    await screen.findByLabelText("What's going well?");

    expect(screen.queryByText(/built from this entry/)).toBeNull();
  });

  it("warns of nothing when the records cannot be read, instead of guessing", async () => {
    const { services, entry } = await setUp(1);
    await renderApp(pathFor("journal-edit", { id: entry.id }), services);
    // The warning is there while the records can be read.
    await screen.findByText(/built from this entry/);
    const listing = vi
      .spyOn(services.records, "list")
      .mockRejectedValue(new Error("synthetic failure"));

    // Any change makes the screen count again, and this time it cannot.
    await services.records.put("journal-entry", { ...entry });
    await waitFor(() => {
      expect(listing).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.queryByText(/built from this entry/)).toBeNull();
    });
    listing.mockRestore();
  });

  it("the delete confirmation warns, and deleting removes the reflection", async () => {
    const { services, entry } = await setUp(1);
    await renderApp(pathFor("journal-entry", { id: entry.id }), services);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete this entry" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => {
      expect(dialog.textContent).toContain(
        dependentsWarning(1, "delete") ?? "",
      );
    });
    await user.click(screen.getByRole("button", { name: "Delete entry" }));

    expect(await screen.findByText(removedText(1))).toBeTruthy();
    expect(await services.reflect.list()).toEqual([]);
  });
});
