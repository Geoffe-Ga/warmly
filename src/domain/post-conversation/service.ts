/**
 * Writing, changing and deleting a reflection made after a conversation
 * (PRD PC-001, PC-003).
 *
 * Every change is local and private. None of them calls AI or the
 * network. Anything that was built from a reflection is removed by the
 * dependency engine when its words change or it is deleted, the same as
 * for a journal entry (ADR-0010).
 */
import { StaleRecordError, type RecordStore } from "../../storage/record-store";
import { sameValue } from "../same";
import {
  afterContentHash,
  canSaveAfter,
  newAfter,
  type AfterResponses,
  type PostConversationReflection,
} from "./types";

/** Every answer was empty, so there is nothing to save. */
export class NothingToSaveError extends Error {
  constructor() {
    super("A reflection needs some text in at least one answer");
    this.name = "NothingToSaveError";
  }
}

/** The reflection to change is not on this device. */
export class AfterNotFoundError extends Error {
  constructor() {
    super("The reflection is not on this device");
    this.name = "AfterNotFoundError";
  }
}

/**
 * Write a new reflection.
 *
 * @param records - The record store.
 * @param responses - The three answers.
 * @param now - The current time.
 * @returns The stored reflection.
 * @throws NothingToSaveError if every answer is empty.
 */
export async function createAfter(
  records: RecordStore,
  responses: AfterResponses,
  now: Date = new Date(),
): Promise<PostConversationReflection> {
  if (!canSaveAfter(responses)) {
    throw new NothingToSaveError();
  }
  const made = await newAfter(responses, now);
  await records.put("post-conversation", made);
  return made;
}

/** What an edit may be told besides the new answers. */
export interface AfterEditOptions {
  /** The current time. */
  readonly now?: Date;
  /**
   * What the reflection said when the person was shown it. If it says
   * something else by the time the edit is saved, the edit is refused
   * (no last-write-wins, invariant 5).
   */
  readonly seen?: AfterResponses;
}

/**
 * Change what a reflection says. It keeps its ID, its day and when it was
 * first written. No copy of the old words is kept.
 *
 * @param records - The record store.
 * @param id - The reflection to change.
 * @param responses - The three answers as they should now be.
 * @param options - See {@link AfterEditOptions}.
 * @returns The stored reflection.
 * @throws AfterNotFoundError if it is not on this device.
 * @throws NothingToSaveError if every answer is empty.
 * @throws StaleRecordError if `options.seen` is given and the reflection
 *   no longer says that. Nothing is stored.
 */
export async function editAfter(
  records: RecordStore,
  id: string,
  responses: AfterResponses,
  options: AfterEditOptions = {},
): Promise<PostConversationReflection> {
  const existing = await records.get("post-conversation", id);
  if (existing === undefined) {
    throw new AfterNotFoundError();
  }
  if (
    options.seen !== undefined &&
    !sameValue(existing.responses, options.seen)
  ) {
    // Not what the person was shown: sync or another tab changed it while
    // the form was open. It is not replaced by words written without
    // seeing it.
    throw new StaleRecordError();
  }
  if (!canSaveAfter(responses)) {
    throw new NothingToSaveError();
  }
  const changed: PostConversationReflection = {
    ...existing,
    responses,
    contentHash: await afterContentHash(responses),
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
  await records.put("post-conversation", changed);
  return changed;
}

/**
 * Delete a reflection for good. There is no trash and no undo.
 *
 * @param records - The record store.
 * @param id - The reflection to delete.
 * @returns Whether there was one to delete.
 */
export async function deleteAfter(
  records: RecordStore,
  id: string,
): Promise<boolean> {
  if ((await records.get("post-conversation", id)) === undefined) {
    return false;
  }
  await records.delete("post-conversation", id);
  return true;
}
