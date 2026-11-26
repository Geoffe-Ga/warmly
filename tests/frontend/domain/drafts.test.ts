import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contentHash } from "../../../src/domain/journal/content-hash";
import {
  AUTOSAVE_DELAY_MS,
  Autosave,
  BLANK,
  completedFrom,
  currentDraft,
  draftFrom,
  draftSaver,
  isBlank,
  type DraftSaverDeps,
  type EntryContent,
  type SaveState,
} from "../../../src/domain/journal/drafts";
import type { JournalEntry } from "../../../src/domain/journal/types";
import { hasText } from "../../../src/domain/journal/validation";

const CONTENT: EntryContent = {
  responses: { good: "half a thought", improve: "", loved: "" },
  feelings: ["tired", "calm"],
};

describe("a blank form (JR-004)", () => {
  it("is one with no text and no feelings", () => {
    expect(isBlank(BLANK)).toBe(true);
    expect(
      isBlank({
        responses: { good: " \n", improve: "\t", loved: "" },
        feelings: [],
      }),
    ).toBe(true);
  });

  it("is not blank once any answer has text or a feeling is chosen", () => {
    for (const key of ["good", "improve", "loved"] as const) {
      expect(
        isBlank({ ...BLANK, responses: { ...BLANK.responses, [key]: "x" } }),
      ).toBe(false);
    }
    expect(isBlank({ ...BLANK, feelings: ["sad"] })).toBe(false);
  });
});

describe("building a draft (JR-004, JR-005)", () => {
  const first = new Date("2026-11-25T23:30:00Z");
  const later = new Date("2026-11-27T08:00:00Z");

  it("makes a new draft with a fresh ID, both times, the day and the content", async () => {
    const draft = await draftFrom(CONTENT, undefined, first);

    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.status).toBe("draft");
    expect(draft.createdAt).toBe("2026-11-25T23:30:00.000Z");
    expect(draft.updatedAt).toBe(draft.createdAt);
    expect(draft.entryDate.date).toMatch(/^2026-11-2[56]$/);
    expect(draft.responses).toEqual(CONTENT.responses);
    expect(draft.feelings).toEqual(["calm", "tired"]);
    expect(draft.contentHash).toBe(await contentHash(CONTENT.responses));
    expect((await draftFrom(CONTENT, undefined, first)).id).not.toBe(draft.id);
  });

  it("is a draft even when every answer is filled in: only finishing completes it", async () => {
    const full = {
      responses: { good: "a", improve: "b", loved: "c" },
      feelings: [],
    };

    const draft = await draftFrom(full);

    expect(draft.status).toBe("draft");
    expect("feelings" in draft).toBe(false);
    expect(Date.parse(draft.updatedAt)).toBeLessThanOrEqual(Date.now());
  });

  it("saved again, stays the same entry: ID, creation time and day are kept", async () => {
    const draft = await draftFrom(CONTENT, undefined, first);
    const changed = {
      responses: { ...CONTENT.responses, improve: "more" },
      feelings: [],
    };

    const again = await draftFrom(changed, draft, later);

    expect(again).toMatchObject({
      id: draft.id,
      createdAt: draft.createdAt,
      entryDate: draft.entryDate,
      updatedAt: "2026-11-27T08:00:00.000Z",
      status: "draft",
      responses: changed.responses,
    });
    expect("feelings" in again).toBe(false);
    expect(again.contentHash).toBe(await contentHash(changed.responses));
    expect(again.contentHash).not.toBe(draft.contentHash);
  });

  it("completed, keeps the draft's ID and creation time and becomes complete", async () => {
    const draft = await draftFrom(CONTENT, undefined, first);

    const done = await completedFrom(CONTENT, draft, later);

    expect(done).toMatchObject({
      id: draft.id,
      createdAt: draft.createdAt,
      entryDate: draft.entryDate,
      updatedAt: "2026-11-27T08:00:00.000Z",
      status: "complete",
    });
    expect((await completedFrom(CONTENT)).status).toBe("complete");
  });
});

describe("the draft to carry on with", () => {
  function stored(
    id: string,
    status: JournalEntry["status"],
    updatedAt: string,
  ): JournalEntry {
    return {
      id,
      createdAt: "2026-11-01T00:00:00.000Z",
      entryDate: { date: "2026-11-01", timeZone: "UTC" },
      updatedAt,
      status,
      responses: BLANK.responses,
      contentHash: "0".repeat(64),
    };
  }

  it("is the most recently changed draft, never a completed entry", () => {
    const entries = [
      stored("old", "draft", "2026-11-02T00:00:00.000Z"),
      stored("done", "complete", "2026-11-09T00:00:00.000Z"),
      stored("new", "draft", "2026-11-05T00:00:00.000Z"),
    ];

    expect(currentDraft(entries)?.id).toBe("new");
    expect(currentDraft([...entries].reverse())?.id).toBe("new");
    expect(entries.map((entry) => entry.id)).toEqual(["old", "done", "new"]);
  });

  it("is nothing when there is no draft", () => {
    expect(currentDraft([])).toBeUndefined();
    expect(
      currentDraft([stored("done", "complete", "2026-11-09T00:00:00.000Z")]),
    ).toBeUndefined();
  });
});

describe("autosave (JR-004)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A save that finishes only when the test says so. */
  function held(): {
    save: (value: string) => Promise<void>;
    saved: string[];
    finish: (ok?: boolean) => Promise<void>;
    running: () => number;
  } {
    const saved: string[] = [];
    const waiting: ((ok: boolean) => void)[] = [];
    return {
      saved,
      save: (value) =>
        new Promise<void>((resolve, reject) => {
          saved.push(value);
          waiting.push((ok) => {
            if (ok) {
              resolve();
            } else {
              reject(new Error("synthetic"));
            }
          });
        }),
      finish: async (ok = true) => {
        waiting.shift()?.(ok);
        await vi.advanceTimersByTimeAsync(0);
      },
      running: () => waiting.length,
    };
  }

  it("waits 800 ms by default", () => {
    expect(AUTOSAVE_DELAY_MS).toBe(800);
  });

  it("saves once, the latest value, after typing has stopped for the delay", async () => {
    const saved: string[] = [];
    const states: SaveState[] = [];
    const autosave = new Autosave<string>(
      (value) => {
        saved.push(value);
        return Promise.resolve();
      },
      (state) => states.push(state),
      500,
    );

    autosave.changed("h");
    await vi.advanceTimersByTimeAsync(499);
    autosave.changed("he");
    await vi.advanceTimersByTimeAsync(499);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(saved).toEqual(["he"]);
    expect(states).toEqual(["waiting", "waiting", "saving", "saved"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saved).toEqual(["he"]);
  });

  it("saves at once when flushed, without waiting for the delay", async () => {
    const saved: string[] = [];
    const autosave = new Autosave<string>(
      (value) => {
        saved.push(value);
        return Promise.resolve();
      },
      () => undefined,
    );
    autosave.changed("half a thought");

    await autosave.flush();

    expect(saved).toEqual(["half a thought"]);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(saved).toEqual(["half a thought"]);
  });

  it("does nothing when flushed with nothing waiting", async () => {
    const save = vi.fn(() => Promise.resolve());
    const onState = vi.fn();

    await new Autosave<string>(save, onState).flush();

    expect(save).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
  });

  it("never runs two saves at once; a value typed during a save waits for its own delay", async () => {
    const slow = held();
    const states: SaveState[] = [];
    const autosave = new Autosave<string>(
      slow.save,
      (state) => states.push(state),
      500,
    );
    autosave.changed("one");
    await vi.advanceTimersByTimeAsync(500);
    expect(slow.saved).toEqual(["one"]);

    autosave.changed("two");
    await slow.finish();
    expect(slow.saved).toEqual(["one"]);
    expect(states.at(-1)).toBe("waiting");
    await vi.advanceTimersByTimeAsync(500);

    expect(slow.saved).toEqual(["one", "two"]);
    expect(slow.running()).toBe(1);
    await slow.finish();
    expect(states.at(-1)).toBe("saved");
  });

  it("flushed during a save, waits for it and then saves the newest value", async () => {
    const slow = held();
    const autosave = new Autosave<string>(slow.save, () => undefined, 500);
    autosave.changed("one");
    await vi.advanceTimersByTimeAsync(500);
    autosave.changed("two");
    autosave.changed("three");
    let flushed = false;
    const flushing = autosave.flush().then(() => {
      flushed = true;
    });

    await slow.finish();
    expect(flushed).toBe(false);
    expect(slow.saved).toEqual(["one", "three"]);
    await slow.finish();
    await flushing;

    expect(flushed).toBe(true);
    expect(slow.running()).toBe(0);
  });

  it("reports a failed save, never rejects, and saves the next change", async () => {
    const slow = held();
    const states: SaveState[] = [];
    const autosave = new Autosave<string>(
      slow.save,
      (state) => states.push(state),
      500,
    );
    autosave.changed("one");
    const flushing = autosave.flush();
    await slow.finish(false);

    await expect(flushing).resolves.toBeUndefined();
    expect(states).toEqual(["waiting", "saving", "failed"]);

    autosave.changed("two");
    await vi.advanceTimersByTimeAsync(500);
    await slow.finish();
    expect(slow.saved).toEqual(["one", "two"]);
    expect(states.at(-1)).toBe("saved");
  });

  it("forgets a waiting value when cancelled", async () => {
    const save = vi.fn(() => Promise.resolve());
    const autosave = new Autosave<string>(save, () => undefined, 500);
    autosave.changed("one");

    autosave.cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    await autosave.flush();

    expect(save).not.toHaveBeenCalled();
  });
});

describe("what counts as text (JR-002)", () => {
  it("counts an invisible character that is not white space, by decision", () => {
    expect(hasText("​")).toBe(true);
    expect(hasText("﻿")).toBe(false);
  });
});

describe("the function that stores the compose form as a draft (JR-004)", () => {
  /** A saver over a list that stands in for the store, and what it was told. */
  function setUp(overrides: Partial<DraftSaverDeps> = {}) {
    const stored: JournalEntry[] = [];
    const refusals: unknown[] = [];
    let current: JournalEntry | undefined;
    const save = draftSaver({
      put: (draft) => {
        stored.push(draft);
        return Promise.resolve();
      },
      current: () => current,
      stored: (draft) => {
        current = draft;
      },
      finishing: () => false,
      refused: (error) => {
        refusals.push(error);
      },
      ...overrides,
    });
    return { save, stored, refusals, current: () => current };
  }

  it("starts a draft from the first content that is worth keeping", async () => {
    const form = setUp();

    await form.save(CONTENT);

    expect(form.stored).toHaveLength(1);
    expect(form.stored[0]?.status).toBe("draft");
    expect(form.stored[0]?.responses.good).toBe("half a thought");
    expect(form.current()).toBe(form.stored[0]);
  });

  it("does not start a draft for a blank form", async () => {
    const form = setUp();

    await form.save(BLANK);

    expect(form.stored).toEqual([]);
    expect(form.current()).toBeUndefined();
  });

  it("writes later content onto the same draft, and saves a form that was emptied", async () => {
    const form = setUp();
    await form.save(CONTENT);
    const first = form.current();

    await form.save(BLANK);

    expect(form.stored).toHaveLength(2);
    expect(form.stored[1]?.id).toBe(first?.id);
    expect(form.stored[1]?.createdAt).toBe(first?.createdAt);
    expect(form.stored[1]?.responses.good).toBe("");
  });

  it("saves nothing once the form is being finished", async () => {
    let finishing = false;
    const form = setUp({ finishing: () => finishing });
    await form.save(CONTENT);
    finishing = true;

    await form.save({ ...CONTENT, feelings: ["sad"] });

    expect(form.stored).toHaveLength(1);
  });

  it("tells why a save was refused, rejects, and keeps building on the last stored draft", async () => {
    const failure = new Error("synthetic");
    let fail = false;
    const kept: JournalEntry[] = [];
    const form = setUp({
      put: (draft) => {
        if (fail) {
          return Promise.reject(failure);
        }
        kept.push(draft);
        return Promise.resolve();
      },
    });
    await form.save(CONTENT);
    const before = form.current();
    fail = true;

    await expect(form.save({ ...CONTENT, feelings: [] })).rejects.toBe(failure);

    expect(form.refusals).toEqual([failure]);
    expect(form.current()).toBe(before);
    expect(kept).toHaveLength(1);
  });
});
