/**
 * The screens for what is written after a conversation: a form the person
 * opens themselves, a labelled place in the journal, and a source Reflect
 * can cite (PRD PC-001 to PC-004, SYNC-005; D-22).
 */
import { cleanup, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { isAfterSource } from "../../../src/ai/provider";
import { AiGateway } from "../../../src/ai/gateway";
import { pathFor } from "../../../src/app/routes";
import type { PostConversationReflection } from "../../../src/domain/post-conversation/types";
import { StaleRecordError } from "../../../src/storage/record-store";
import {
  AFTER_LEAD,
  AFTER_OUT_OF_DATE,
  NEW_AFTER,
  NOTHING_WRITTEN,
} from "../../../src/ui/screens/journal/AfterConversation";
import {
  describeSent,
  tooLongNote,
} from "../../../src/ui/components/AiDisclosureDialog";
import { coverageNote } from "../../../src/ui/components/CitedAnswer";
import { dependentsWarning } from "../../../src/ui/screens/journal/dependents";
import { entryTooLong } from "../../../src/ui/screens/reflect/Session";
import {
  heading,
  renderApp,
  testServices,
  visit,
  type TestServices,
} from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
});

const AFTER: PostConversationReflection = {
  id: "00000000-0000-4000-8000-0000000000c1",
  createdAt: "2026-11-20T18:30:00.000Z",
  entryDate: { date: "2026-11-20", timeZone: "UTC" },
  updatedAt: "2026-11-20T18:30:00.000Z",
  responses: {
    went_well: "We both stayed calm in the kitchen.",
    difficult: "",
    remember: "Ask before assuming.",
  },
  contentHash: "5".repeat(64),
};
const NEW = pathFor("after-conversation", { id: NEW_AFTER });
const HERE = pathFor("after-conversation", { id: AFTER.id });

function box(label: string): HTMLTextAreaElement {
  return screen.getByLabelText(new RegExp(label)) as HTMLTextAreaElement;
}

async function press(name: string | RegExp): Promise<void> {
  await userEvent.setup().click(await screen.findByRole("button", { name }));
}

describe("the form (PC-001, PC-003)", () => {
  it("asks the three questions, says each is optional, and is not called an entry", async () => {
    await renderApp(NEW, testServices("unlocked"));

    expect(heading().textContent).toBe("After a conversation");
    expect(screen.getByText(AFTER_LEAD)).toBeTruthy();
    expect(box("What went well\\?").value).toBe("");
    expect(box("What felt difficult or unresolved\\?").value).toBe("");
    expect(box("What would you like to remember\\?").value).toBe("");
    expect(screen.getAllByText("Optional.")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("saves nothing, and says why, when nothing is written", async () => {
    const services = testServices("unlocked");
    await renderApp(NEW, services);

    await press("Save");

    expect(await screen.findByText(NOTHING_WRITTEN)).toBeTruthy();
    expect(await services.records.list("post-conversation")).toEqual([]);
  });

  it("saves one answer on its own, as its own kind of record", async () => {
    const services = testServices("unlocked");
    await renderApp(NEW, services);

    await userEvent
      .setup()
      .type(box("What would you like to remember\\?"), "The walk helped.");
    await press("Save");

    await screen.findByRole("button", { name: "Save changes" });
    const [stored] = await services.records.list("post-conversation");
    expect(stored?.responses).toEqual({
      went_well: "",
      difficult: "",
      remember: "The walk helped.",
    });
    expect(await services.records.list("journal-entry")).toEqual([]);
  });

  it("opens one already written, and saves a change to it", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    await renderApp(HERE, services);

    const difficult = await screen.findByLabelText(/What felt difficult/);
    expect(box("What went well\\?").value).toBe(AFTER.responses.went_well);
    expect(screen.getByText(/Written on .*20.*2026/)).toBeTruthy();
    await userEvent.setup().type(difficult, "One thing was left open.");
    await press("Save changes");

    expect(await screen.findByText("Saved on this device.")).toBeTruthy();
    const stored = await services.records.get("post-conversation", AFTER.id);
    expect(stored?.responses.difficult).toBe("One thing was left open.");
    expect(stored?.contentHash).not.toBe(AFTER.contentHash);
  });

  it("is deleted only after the person confirms", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    await renderApp(HERE, services);

    await press("Delete this");
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText(/There is no trash and no undo/)).toBeTruthy();
    await userEvent
      .setup()
      .click(dialog.getByRole("button", { name: "Keep it" }));
    expect(await services.records.list("post-conversation")).toHaveLength(1);

    await press("Delete this");
    await userEvent.setup().click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    expect(
      await screen.findByText("It has been removed from this device."),
    ).toBeTruthy();
    expect(await services.records.list("post-conversation")).toEqual([]);
    // The button that had focus is gone, so focus moves to the heading.
    await waitFor(() => {
      expect(document.activeElement).toBe(heading());
    });
  });

  it("says so when it is not on this device", async () => {
    await renderApp(
      pathFor("after-conversation", {
        id: "00000000-0000-4000-8000-00000000dead",
      }),
      testServices("unlocked"),
    );

    expect(
      await screen.findByText(
        "This isn't on this device. It may have been deleted.",
      ),
    ).toBeTruthy();
  });

  it("saves what was typed when the app locks, and nothing when nothing was", async () => {
    const services = testServices("unlocked");
    await renderApp(NEW, services);

    await services.lockHooks.flush();
    expect(await services.records.list("post-conversation")).toEqual([]);

    await userEvent
      .setup()
      .type(box("What went well\\?"), "Typed, not yet saved.");
    await services.lockHooks.flush();

    const [stored] = await services.records.list("post-conversation");
    expect(stored?.responses.went_well).toBe("Typed, not yet saved.");
  });

  it("writes one note, not two, when the app locks at the moment a new one is saved", async () => {
    const services = testServices("unlocked");
    const put = services.records.put.bind(services.records);
    let locked: Promise<unknown> | undefined;
    services.records.put = (kind, record) => {
      const stored = put(kind, record);
      if (kind === "post-conversation" && locked === undefined) {
        // The lock arrives the instant the note is stored, before the
        // screen has heard that its Save finished.
        void stored.then(() => {
          locked = services.lockHooks.flush();
        });
      }
      return stored;
    };
    await renderApp(NEW, services);
    await userEvent.setup().type(box("What went well\\?"), "Written once.");

    await press("Save");
    await screen.findByRole("button", { name: "Save changes" });
    await locked;

    const stored = await services.records.list("post-conversation");
    expect(stored.map((each) => each.responses.went_well)).toEqual([
      "Written once.",
    ]);
  });

  it("keeps what was typed as a new note when the app locks and the note was changed elsewhere meanwhile", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    await renderApp(HERE, services);
    await userEvent
      .setup()
      .type(await screen.findByLabelText(/What felt difficult/), "Typed here.");
    // Another tab changed this note since it was opened here, so a save
    // over it is refused.
    const put = services.records.put.bind(services.records);
    services.records.put = (kind, record) =>
      kind === "post-conversation" && record.id === AFTER.id
        ? Promise.reject(new StaleRecordError())
        : put(kind, record);

    const failed = await services.lockHooks.flush();

    expect(failed).toBe(0);
    const notes = await services.records.list("post-conversation");
    // The other version is untouched, and the typed words are not lost.
    expect(notes).toHaveLength(2);
    expect(notes.find((each) => each.id === AFTER.id)).toEqual(AFTER);
    expect(
      notes.find((each) => each.id !== AFTER.id)?.responses.difficult,
    ).toBe("Typed here.");
  });

  it("is not saved over when sync changed it while the form was open (invariant 5)", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    await renderApp(HERE, services);
    await userEvent
      .setup()
      .type(await screen.findByLabelText(/What felt difficult/), "Typed here.");
    // Another device's change arrives: the store now holds a newer note,
    // and its own stale-copy check has nothing to object to.
    const newer: PostConversationReflection = {
      ...AFTER,
      responses: { ...AFTER.responses, remember: "From the phone." },
      contentHash: "1".repeat(64),
    };
    await services.records.put("post-conversation", newer);

    await press("Save changes");

    expect(await screen.findByText(AFTER_OUT_OF_DATE)).toBeTruthy();
    expect(await services.records.get("post-conversation", AFTER.id)).toEqual(
      newer,
    );

    // The same at a lock: the typed words become a note of their own.
    expect(await services.lockHooks.flush()).toBe(0);
    const notes = await services.records.list("post-conversation");
    expect(notes).toHaveLength(2);
    expect(notes.find((each) => each.id === AFTER.id)).toEqual(newer);
  });

  it("stores a change once when the app locks while Save changes is still storing it", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    const put = services.records.put.bind(services.records);
    let puts = 0;
    let locked: Promise<unknown> | undefined;
    services.records.put = (kind, record) => {
      const stored = put(kind, record);
      if (kind === "post-conversation") {
        puts += 1;
        if (locked === undefined) {
          void stored.then(() => {
            locked = services.lockHooks.flush();
          });
        }
      }
      return stored;
    };
    await renderApp(HERE, services);
    await userEvent
      .setup()
      .type(await screen.findByLabelText(/What felt difficult/), "Once.");

    await press("Save changes");
    await screen.findByText("Saved on this device.");
    await locked;

    expect(puts).toBe(1);
  });

  it("saves a typed change to an existing one when the app locks", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    await renderApp(HERE, services);

    await userEvent
      .setup()
      .type(await screen.findByLabelText(/What felt difficult/), "Added.");
    await services.lockHooks.flush();

    expect(
      (await services.records.get("post-conversation", AFTER.id))?.responses
        .difficult,
    ).toBe("Added.");
  });
});

describe("its place in the journal (PC-003)", () => {
  it("is listed under its own label, never as an entry, and found by search", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    await renderApp(pathFor("journal"), services);

    const link = await screen.findByRole("link", {
      name: /^After a conversation: .*20.*2026/,
    });
    expect(link.getAttribute("href")).toBe(HERE);

    await userEvent
      .setup()
      .type(screen.getByLabelText("Search your journal"), "kitchen");

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /^After a conversation: / }),
      ).toBeTruthy();
    });
  });

  it("offers the form from the journal, where the person chooses it", async () => {
    await renderApp(pathFor("journal"), testServices("unlocked"));

    const link = await screen.findByRole("link", {
      name: "Write about a conversation you had",
    });
    expect(link.getAttribute("href")).toBe(NEW);
  });
});

describe("as a source in Reflect (PC-004)", () => {
  async function asked(): Promise<{
    services: TestServices;
    provider: FakeProvider;
  }> {
    const provider = new FakeProvider();
    const services: TestServices = {
      ...testServices("unlocked"),
      ai: new AiGateway(provider),
    };
    await services.records.put("post-conversation", AFTER);
    await renderApp(pathFor("reflect-session", { id: "new" }), services);
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText(
        /What would you like to ask about your journal/,
      ),
      "What helped?",
    );
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await user.click(
      await screen.findByRole("button", { name: "Send to Test provider" }),
    );
    await screen.findByRole("heading", { name: "Ask more" });
    return { services, provider };
  }

  it("can be asked about with no journal entry, and is sent under its own kind", async () => {
    const { provider } = await asked();

    const [call] = provider.calls;
    expect(call?.kind === "reflect" && call.sources).toEqual([
      {
        alias: "E1",
        kind: "post_conversation",
        responses: AFTER.responses,
      },
    ]);
  });

  it("says, where the question is typed, that it is sent too", async () => {
    await asked();

    expect(
      screen.getByText(
        /Your finished entries, and anything you wrote after a conversation, are sent with it/,
      ),
    ).toBeTruthy();
  });

  it("is cited by name as what it is, with a link to its own screen", async () => {
    await asked();

    const links = await screen.findAllByRole("link", {
      name: /what you wrote after a conversation on/i,
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(HERE);
    }
    expect(screen.queryByRole("link", { name: /your entry from/i })).toBeNull();
  });

  it("warns, on its own screen, that the answer built from it goes if it changes", async () => {
    const { services } = await asked();
    cleanup();
    await renderApp(HERE, services);

    expect(
      await screen.findByText(dependentsWarning(1, "edit", "after") ?? ""),
    ).toBeTruthy();
  });
});

describe("the words used for it", () => {
  it("never call it an entry in the warning about what was built from it", () => {
    expect(dependentsWarning(0, "edit", "after")).toBeUndefined();
    expect(dependentsWarning(1, "edit", "after")).toBe(
      "1 reflection was built in Reflect from what you wrote here. It will be removed if you change the words of your answers, because an answer may repeat what you wrote. Nothing is sent anywhere and nothing is written again.",
    );
    expect(dependentsWarning(2, "delete", "after")).toBe(
      "2 reflections were built in Reflect from what you wrote here. They will be removed when you delete it, because an answer may repeat what you wrote. Nothing is sent anywhere and nothing is written again.",
    );
  });

  it.each([
    [
      { entries: 3, after: 1 },
      "2 journal entries, 1 note written after a conversation, and your question",
    ],
    [
      { entries: 2, after: 2 },
      "2 notes written after conversations and your question",
    ],
    [
      { entries: 4, after: 1, omitted: 10, afterOmitted: 3 },
      "3 of your 10 journal entries, 1 of your 4 notes written after conversations, and your question",
    ],
    [
      { entries: 1200, after: 0, omitted: 5, afterOmitted: 5 },
      "1200 journal entries, 0 of your 5 notes written after conversations, and your question",
    ],
    [
      { entries: 1, after: 1, earlierTurns: 2 },
      "1 note written after a conversation, your question, and the earlier questions and answers in this reflection",
    ],
  ])(
    "counts them apart from journal entries before anything is sent: %j",
    (sent, text) => {
      expect(
        describeSent({
          provider: "Example AI",
          omitted: 0,
          tooLong: 0,
          afterOmitted: 0,
          afterTooLong: 0,
          earlierTurns: 0,
          also: "your question",
          estimatedTokens: 900,
          large: false,
          ...sent,
        }),
      ).toBe(text);
    },
  );

  it("names both kinds above an answer that rests on part of what was written", () => {
    const answer = {
      markdown: "A reading.",
      citations: [],
      sources: [],
      coverage: {
        includedEntryIds: ["a", "b"],
        omittedEntryCount: 3,
        truncated: true,
      },
    };

    expect(coverageNote(answer, true)).toBe(
      "This answer is about 2 of the 5 journal entries and notes written after conversations you had when you asked. The others did not fit in one request, so it does not speak for your whole journal.",
    );
    expect(coverageNote(answer)).toContain(
      "2 of the 5 journal entries you had",
    );
  });

  it.each([
    [
      1,
      1,
      "1 note written after a conversation is too long to send in one request, so it is left out. Warmly sends each whole, never part of one.",
    ],
    [
      3,
      3,
      "3 notes written after conversations are too long to send in one request, so they are left out. Warmly sends each whole, never part of one.",
    ],
    [
      2,
      1,
      "1 entry and 1 note written after a conversation are too long to send in one request, so they are left out. Warmly sends each whole, never part of one.",
    ],
    [
      1,
      0,
      "1 entry is too long to send in one request, so it is left out. Warmly sends whole entries only, never part of one.",
    ],
    [
      1200,
      0,
      "1,200 entries are too long to send in one request, so they are left out. Warmly sends whole entries only, never part of one.",
    ],
  ])(
    "never call it an entry when it is left out for being too long: %i left out, %i of them notes",
    (count, after, text) => {
      expect(tooLongNote(count, after)).toBe(text);
    },
  );

  it("counts a source as a note only when it is labelled as one", () => {
    const journal = {
      id: "a",
      contentHash: "1".repeat(64),
      responses: { good: "a", improve: "b", loved: "c" },
    };

    expect(isAfterSource(journal)).toBe(false);
    expect(isAfterSource({ ...journal, kind: "journal_entry" })).toBe(false);
    expect(
      isAfterSource({
        id: "b",
        contentHash: "2".repeat(64),
        kind: "post_conversation",
        responses: { went_well: "a", difficult: "", remember: "" },
      }),
    ).toBe(true);
  });

  it("never call it an entry when it is too long to send", () => {
    expect(entryTooLong("20 November 2026", true)).toBe(
      "What you wrote after a conversation on 20 November 2026 is too long to send in one request, and no other entry can be sent either, so nothing was sent. Warmly sends whole entries only, and never part of one.",
    );
  });
});

describe("changed in two places (SYNC-005)", () => {
  const THEIRS: PostConversationReflection = {
    ...AFTER,
    responses: {
      ...AFTER.responses,
      difficult: "Written on the other device.",
    },
    contentHash: "6".repeat(64),
  };

  it("shows both versions in full and keeps the one chosen", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    services.records.park(AFTER.id, THEIRS, 2, "post-conversation");
    await renderApp(pathFor("sync-conflicts"), services);

    const region = within(
      await screen.findByRole("region", { name: "A piece of writing" }),
    );
    expect(
      region.getByText(/was changed here and on another device/),
    ).toBeTruthy();
    expect(region.getAllByText(AFTER.responses.went_well)).toHaveLength(2);
    expect(region.getByText("Written on the other device.")).toBeTruthy();
    expect(region.getAllByText("Nothing written.")).toHaveLength(1);

    await press("Keep the other version");

    await screen.findByText(
      "The other device's version of the piece of writing was kept.",
    );
    expect(
      (await services.records.get("post-conversation", AFTER.id))?.responses
        .difficult,
    ).toBe("Written on the other device.");
  });

  it("one deleted elsewhere can be kept as a new one, under a new ID", async () => {
    const services = testServices("unlocked");
    await services.records.put("post-conversation", AFTER);
    services.records.park(AFTER.id, undefined, 2, "post-conversation");
    await renderApp(pathFor("sync-conflicts"), services);
    expect(
      (await screen.findByRole("region", { name: "A piece of writing" }))
        .textContent,
    ).toContain("Something deleted does not come back.");

    await press("Keep mine as a new piece of writing");

    await screen.findByText("Your version was kept as a new piece of writing.");
    const [kept] = await services.records.list("post-conversation");
    expect(kept?.id).not.toBe(AFTER.id);
    expect(kept?.responses).toEqual(AFTER.responses);
  });
});
