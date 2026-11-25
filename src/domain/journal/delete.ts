/**
 * Deleting a journal entry for good (PRD JR-007, OPS-003; AC-17).
 *
 * There is no trash and no undo. The store replaces the entry's ciphertext
 * with a tombstone and queues the deletion for the person's other devices
 * in one transaction, so the entry cannot come back on this device and a
 * stale device cannot bring it back later.
 */
import type { EventBus } from "../events";
import type { RecordStore } from "../../storage/record-store";

/**
 * Delete an entry or a draft.
 *
 * A completed entry's deletion is announced as `journal.deleted`, after it
 * is stored, so that work built from the entry can be dealt with. A draft
 * was never built on, so deleting one announces nothing.
 *
 * @param deps - The record store and the event bus.
 * @param id - The entry's ID.
 * @returns Whether there was an entry to delete.
 */
export async function deleteEntry(
  deps: { readonly records: RecordStore; readonly events: EventBus },
  id: string,
): Promise<boolean> {
  const existing = await deps.records.get("journal-entry", id);
  if (existing === undefined) {
    return false;
  }
  await deps.records.delete("journal-entry", id);
  if (existing.status === "complete") {
    await deps.events.emit("journal.deleted", {
      entryId: id,
      oldHash: existing.contentHash,
    });
  }
  return true;
}
