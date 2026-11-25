import { describe, expect, it } from "vitest";

import { createEventBus } from "../../../src/domain/events";
import { completedFrom } from "../../../src/domain/journal/drafts";
import {
  deleteAnyway,
  discardMine,
  isDeletedElsewhere,
  isDeletedHere,
  isEdited,
  keepEdited,
  keepMine,
  keepTheirs,
  listConflicts,
  saveAsNew,
} from "../../../src/sync/conflicts";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { OWNER, device, entry, type Device } from "./devices";

/** A small seeded random number generator, so every run is the same. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DEVICES = 3;
const STEPS = 45;
const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

/** The IDs the server holds as deleted. */
function deletedOnServer(server: MemoryServer): string[] {
  const found: string[] = [];
  let cursor = "0";
  for (;;) {
    const page = server.pull(OWNER, cursor);
    found.push(
      ...page.changes
        .filter((change) => change.tombstone)
        .map((change) => change.recordId),
    );
    if (!page.hasMore) {
      return found;
    }
    cursor = page.nextCursor;
  }
}

/** How often each kind of clash came up, over every seed. */
const met = { edited: 0, "deleted-elsewhere": 0, "deleted-here": 0 };

/** Settle everything waiting on a device, each one a way the person could. */
async function settleAll(target: Device, random: () => number): Promise<void> {
  const deps = { records: target.store, events: createEventBus() };
  for (const conflict of await listConflicts(target.store)) {
    const first = random() < 0.5;
    if (conflict.kind !== "unreadable") {
      met[conflict.kind] += 1;
    }
    if (isEdited(conflict)) {
      await (first ? keepMine : keepTheirs)(deps, conflict);
    } else if (isDeletedElsewhere(conflict)) {
      await (first ? saveAsNew : discardMine)(deps, conflict);
    } else if (isDeletedHere(conflict)) {
      await (first ? deleteAnyway : keepEdited)(deps, conflict);
    }
  }
}

/** One random thing a person might do on one device. */
async function act(
  target: Device,
  step: number,
  random: () => number,
): Promise<void> {
  const roll = random();
  const mine = await target.store.list("journal-entry");
  const picked = mine[Math.floor(random() * mine.length)];
  if (roll < 0.2 || picked === undefined) {
    await target.store.put(
      "journal-entry",
      await entry(`made at ${String(step)}`),
    );
  } else if (roll < 0.45) {
    await target.store.put(
      "journal-entry",
      await completedFrom(
        {
          responses: { ...picked.responses, good: `edited at ${String(step)}` },
          feelings: [],
        },
        picked,
      ),
    );
  } else if (roll < 0.6) {
    await target.store.delete("journal-entry", picked.id);
  } else if (roll < 0.9) {
    await target.sync();
  } else {
    await settleAll(target, random);
  }
}

describe("any order of creating, editing and deleting on three devices (SYNC-005, AC-17)", () => {
  it.each(SEEDS)(
    "ends with every device the same and no deleted entry readable (seed %i)",
    async (seed) => {
      const random = seeded(seed);
      const server = new MemoryServer();
      const devices = await Promise.all(
        Array.from({ length: DEVICES }, () => device(server)),
      );
      const everDeleted = new Set<string>();

      for (let step = 0; step < STEPS; step += 1) {
        const target = devices[Math.floor(random() * DEVICES)];
        if (target === undefined) {
          throw new Error("a device is expected");
        }
        await act(target, step, random);
        // A deletion the server has accepted is never undone, at any point.
        const now = new Set(deletedOnServer(server));
        for (const id of everDeleted) {
          expect(now.has(id)).toBe(true);
        }
        for (const id of now) {
          everDeleted.add(id);
        }
      }

      // Everyone comes online, settles what is waiting, and syncs until
      // nothing moves any more.
      let quiet = false;
      for (let round = 0; round < 12 && !quiet; round += 1) {
        for (const each of devices) {
          await settleAll(each, random);
          await each.sync();
        }
        const states = devices.map((each) => each.engine.state());
        const waiting = await Promise.all(
          devices.map((each) => each.store.parkedCount()),
        );
        quiet =
          states.every((state) => state.status === "synced") &&
          waiting.every((count) => count === 0);
      }
      expect(quiet).toBe(true);
      // One more pass so every device has pulled the others' last changes.
      for (const each of devices) {
        await each.sync();
      }

      const lists = await Promise.all(
        devices.map(async (each) =>
          (await each.store.list("journal-entry")).sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
        ),
      );
      expect(lists[1]).toEqual(lists[0]);
      expect(lists[2]).toEqual(lists[0]);
      const deleted = deletedOnServer(server);
      for (const id of everDeleted) {
        expect(deleted).toContain(id);
      }
      for (const each of devices) {
        for (const id of deleted) {
          expect(await each.store.get("journal-entry", id)).toBeUndefined();
        }
      }
    },
  );

  it("met every kind of clash along the way, so the runs above mean something", () => {
    expect(met.edited).toBeGreaterThan(5);
    expect(met["deleted-elsewhere"]).toBeGreaterThan(5);
    expect(met["deleted-here"]).toBeGreaterThan(5);
  });
});
