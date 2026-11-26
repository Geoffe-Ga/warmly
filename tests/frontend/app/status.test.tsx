/**
 * The status of everything that protects the person's writing, in one
 * place and in plain words (PRD UI-008; AC-23).
 */
import { cleanup, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import { DELETE_WARNING } from "../../../src/ui/screens/journal/Entry";
import {
  DELETING_STATUS,
  STATUS_ITEMS,
} from "../../../src/ui/screens/settings/StatusSummary";

import { renderApp, testServices, visit, type TestServices } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

async function open(services: TestServices) {
  await renderApp("/settings", services);
  return within(
    await screen.findByRole("region", { name: "Privacy and status" }),
  );
}

function valueOf(summary: ReturnType<typeof within>, label: string): string {
  const term = summary.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

describe("the status summary in Settings (UI-008)", () => {
  it("covers encryption, connection, sync, the AI provider, the recovery key, devices and deletion", async () => {
    const summary = await open(testServices("unlocked"));

    expect(STATUS_ITEMS).toEqual([
      "Encryption",
      "Connection",
      "Sync",
      "AI provider",
      "Recovery key",
      "Devices",
      "Deleting",
    ]);
    for (const label of STATUS_ITEMS) {
      expect(valueOf(summary, label), label).not.toBe("");
    }
  });

  it("says what encryption covers without overclaiming", async () => {
    const summary = await open(testServices("unlocked"));

    expect(valueOf(summary, "Encryption")).toBe(
      "On. What you write is encrypted on this device before it is saved or synced, so Warmly's servers cannot read it. It is readable on this device while Warmly is unlocked, and by an AI provider only when you choose to send it.",
    );
  });

  it("reports the connection and sync as they are, in a state and a count only", async () => {
    const summary = await open(testServices("unlocked"));

    expect(valueOf(summary, "Connection")).toBe("Online.");
    // The test services have a sync engine with nothing to send.
    expect(valueOf(summary, "Sync")).toMatch(
      /All changes saved|Nothing is waiting|Couldn't sync|waiting to sync/,
    );
  });

  it("says when no AI provider is connected, and names one that is", async () => {
    const none = await open({
      ...testServices("unlocked"),
      ai: new AiGateway(undefined),
    });
    expect(valueOf(none, "AI provider")).toBe(
      "None connected. Nothing can be sent to an AI provider.",
    );
    cleanup();

    const withProvider = await open({
      ...testServices("unlocked"),
      ai: new AiGateway(new FakeProvider()),
    });
    expect(valueOf(withProvider, "AI provider")).toBe(
      "Test provider is connected. Nothing is sent to it unless you ask, and you are shown what would be sent each time.",
    );
  });

  it("says where the recovery key and the devices are managed, without repeating their links", async () => {
    const summary = await open(testServices("unlocked"));

    expect(valueOf(summary, "Recovery key")).toContain(
      "You can replace it below.",
    );
    expect(valueOf(summary, "Devices")).toContain(
      "See Manage Devices, in the menu at the top.",
    );
    expect(summary.queryAllByRole("link")).toEqual([]);
    // The links themselves are on the page once each.
    expect(
      screen.getAllByRole("link", { name: "Replace your recovery key" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("link", { name: "Manage Devices" }),
    ).toHaveLength(1);
  });

  it("says the same about deleting as the warning shown before a deletion", () => {
    for (const promise of [
      "There is no trash and no undo.",
      "the next time they sync",
      "Encrypted copies held in backups cannot be read by anyone but you, and are removed as those backups expire, within 30 days.",
    ]) {
      expect(DELETING_STATUS).toContain(promise);
      expect(DELETE_WARNING).toContain(promise);
    }
  });

  it("holds nothing the person wrote", async () => {
    const services = testServices("unlocked");
    await services.records.put("journal-entry", {
      id: "00000000-0000-4000-8000-0000000000e1",
      createdAt: "2026-11-03T10:00:00.000Z",
      entryDate: { date: "2026-11-03", timeZone: "UTC" },
      updatedAt: "2026-11-03T10:00:00.000Z",
      status: "complete",
      responses: {
        good: "CANARY one",
        improve: "CANARY two",
        loved: "CANARY three",
      },
      contentHash: "1".repeat(64),
    });

    await open(services);

    expect(document.body.textContent).not.toContain("CANARY");
  });
});
