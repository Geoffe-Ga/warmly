import { describe, expect, it, vi } from "vitest";

import { createEventBus } from "../../../src/domain/events";

const CHANGE = {
  entryId: "entry-1",
  oldHash: "a".repeat(64),
  newHash: "b".repeat(64),
};

describe("the domain event bus (DEP-001)", () => {
  it("gives an event to every listener for it", async () => {
    const bus = createEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.on("journal.changed", first);
    bus.on("journal.changed", second);

    await bus.emit("journal.changed", CHANGE);

    expect(first).toHaveBeenCalledExactlyOnceWith(CHANGE);
    expect(second).toHaveBeenCalledExactlyOnceWith(CHANGE);
  });

  it("does nothing, and does not fail, with no listeners", async () => {
    await expect(
      createEventBus().emit("journal.changed", CHANGE),
    ).resolves.toBeUndefined();
  });

  it("stops calling a listener once it has been removed, and only that one", async () => {
    const bus = createEventBus();
    const removed = vi.fn();
    const kept = vi.fn();
    const stop = bus.on("journal.changed", removed);
    bus.on("journal.changed", kept);

    stop();
    stop();
    await bus.emit("journal.changed", CHANGE);

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("waits for listeners that do asynchronous work", async () => {
    const bus = createEventBus();
    let finished = false;
    bus.on("journal.changed", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });

    await bus.emit("journal.changed", CHANGE);

    expect(finished).toBe(true);
  });

  it("runs every listener even when one fails, then reports the failures", async () => {
    const bus = createEventBus();
    const after = vi.fn();
    bus.on("journal.changed", () => {
      throw new Error("synthetic, thrown at once");
    });
    bus.on("journal.changed", () =>
      Promise.reject(new Error("synthetic, later")),
    );
    bus.on("journal.changed", after);

    const emitting = bus.emit("journal.changed", CHANGE);

    await expect(emitting).rejects.toBeInstanceOf(AggregateError);
    await expect(emitting).rejects.toMatchObject({
      message: "A listener to journal.changed failed",
      errors: [
        new Error("synthetic, thrown at once"),
        new Error("synthetic, later"),
      ],
    });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("gives each kind of event only to its own listeners", async () => {
    const bus = createEventBus();
    const changed = vi.fn();
    const deleted = vi.fn();
    bus.on("journal.changed", changed);
    bus.on("journal.deleted", deleted);
    const gone = { entryId: "entry-1", oldHash: "a".repeat(64) };

    await bus.emit("journal.deleted", gone);

    expect(deleted).toHaveBeenCalledExactlyOnceWith(gone);
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps separate buses apart", async () => {
    const heard = vi.fn();
    createEventBus().on("journal.changed", heard);

    await createEventBus().emit("journal.changed", CHANGE);

    expect(heard).not.toHaveBeenCalled();
  });
});
