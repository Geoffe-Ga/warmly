/**
 * Where a screen's way back, main action and delete button sit
 * (PRD UX-001, UI-002; issue #137).
 */
import { cleanup, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import { newEntry } from "../../../src/domain/journal/types";
import { DangerZone } from "../../../src/ui/components/DangerZone";
import { PageLayout } from "../../../src/ui/components/PageLayout";
import { renderApp, testServices } from "../app/helpers";

afterEach(() => {
  cleanup();
});

/** Whether one element comes before another in the page. */
function comesBefore(first: Element, second: Element): boolean {
  return (
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  );
}

describe("the way back", () => {
  it("is above the page heading, so it is on screen however long the page is", () => {
    render(
      <PageLayout title="A screen" back={{ href: "/journal", label: "Back" }}>
        <p>Content</p>
      </PageLayout>,
    );

    const back = screen.getByRole("link", { name: "Back" });
    expect(back.getAttribute("href")).toBe("/journal");
    expect(comesBefore(back, screen.getByRole("heading", { level: 1 }))).toBe(
      true,
    );
  });

  it("is left out when a screen has nowhere to go back to", () => {
    render(<PageLayout title="A screen" />);

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is on an entry's page once, above its heading, in the same words as before", async () => {
    const services = testServices("unlocked");
    const entry = await newEntry({ good: "a", improve: "b", loved: "c" });
    await services.records.put("journal-entry", entry);

    await renderApp(`/journal/entries/${entry.id}`, services);
    await screen.findByRole("button", { name: "Delete this entry" });

    const links = screen.getAllByRole("link", { name: "Back to your journal" });
    expect(links).toHaveLength(1);
    expect(
      comesBefore(
        links[0] as Element,
        screen.getByRole("heading", { level: 1 }),
      ),
    ).toBe(true);
  });
});

describe("a screen's main action", () => {
  it("is a link that looks like a button on the journal, with the second action beside it", async () => {
    await renderApp("/journal", testServices("unlocked"));

    const write = await screen.findByRole("link", {
      name: "Write a new entry",
    });
    const after = screen.getByRole("link", {
      name: "Write about a conversation you had",
    });
    // Still links: they go somewhere.
    expect(write.getAttribute("href")).toBe("/journal/new");
    expect(write.className).toBe("button button--primary");
    expect(after.className).toBe("button button--secondary");
    expect(write.parentElement).toBe(after.parentElement);
  });

  it("is a link that looks like a button on Reflect", async () => {
    await renderApp("/reflect", testServices("unlocked"));

    const ask = await screen.findByRole("link", { name: "Ask a question" });
    expect(ask.className).toBe("button button--primary");
  });

  it("leaves Home as exactly three primary actions (UX-001)", async () => {
    await renderApp("/", testServices("unlocked"));

    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /Back/ })).toBeNull();
  });
});

describe("a delete button", () => {
  it("sits in a section of its own, headed Delete", () => {
    render(
      <DangerZone>
        <button type="button">Delete this</button>
      </DangerZone>,
    );

    const heading = screen.getByRole("heading", { level: 2, name: "Delete" });
    expect(
      heading.parentElement?.contains(
        screen.getByRole("button", { name: "Delete this" }),
      ),
    ).toBe(true);
  });

  it("is headed one level down inside a card", () => {
    render(
      <DangerZone nested>
        <button type="button">Delete this</button>
      </DangerZone>,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Delete" }),
    ).toBeTruthy();
  });

  it("on an entry is apart from Edit this entry, and comes after it", async () => {
    const services = testServices("unlocked");
    const entry = await newEntry({ good: "a", improve: "b", loved: "c" });
    await services.records.put("journal-entry", entry);

    await renderApp(`/journal/entries/${entry.id}`, services);
    const remove = await screen.findByRole("button", {
      name: "Delete this entry",
    });
    const edit = screen.getByRole("link", { name: "Edit this entry" });

    const zone = remove.closest(".danger-zone");
    expect(zone).not.toBeNull();
    expect(zone?.contains(edit)).toBe(false);
    expect(comesBefore(edit, remove)).toBe(true);
    expect(
      within(zone as HTMLElement).getByRole("heading", { name: "Delete" }),
    ).toBeTruthy();
  });
});
