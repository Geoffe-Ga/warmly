/**
 * An in-memory sync server that follows ADR-0006 exactly.
 *
 * It is the protocol in runnable form: client tests sync through it, and it
 * passes the same scenario table the real backend must pass. It keeps what
 * it is given and never looks inside a payload. It is never part of a
 * production build.
 */
import { ApiError } from "../../api/client";
import {
  MAX_OPERATIONS_PER_BATCH,
  type ChangePage,
  type OperationResult,
  type RemoteChange,
  type SyncOperation,
} from "../protocol";
import type { SyncTransport } from "../transport";

/** One record as the server holds it. */
interface ServerRecord {
  readonly type: number;
  readonly revision: number;
  readonly sequence: number;
  readonly schemaVersion: number;
  readonly tombstone: boolean;
  readonly payload: Uint8Array<ArrayBuffer> | null;
}

/** Everything the server holds for one account. */
interface OwnerState {
  readonly records: Map<string, ServerRecord>;
  /** The revision each applied operation produced, by operation ID. */
  readonly applied: Map<string, number>;
  sequence: number;
}

/** The in-memory server: records for any number of accounts. */
export class MemoryServer {
  /** Marks this as a stand-in; a test checks it is not in a real build. */
  readonly name = "warmly.fake.sync-server";
  readonly #owners = new Map<string, OwnerState>();
  /** How many changes a page of the feed holds. */
  pageSize = 100;
  /** While false, every request fails as if the network were down. */
  reachable = true;

  #owner(owner: string): OwnerState {
    let state = this.#owners.get(owner);
    if (state === undefined) {
      state = { records: new Map(), applied: new Map(), sequence: 0 };
      this.#owners.set(owner, state);
    }
    return state;
  }

  #apply(state: OwnerState, operation: SyncOperation): OperationResult {
    const { opId } = operation;
    const earlier = state.applied.get(opId);
    if (earlier !== undefined) {
      return { opId, status: "duplicate", revision: earlier };
    }
    const stored = state.records.get(operation.recordId);
    if (stored === undefined) {
      // A record the server has never seen can only be started from 0.
      if (operation.baseRevision !== 0) {
        return { opId, status: "rejected" };
      }
    } else if (stored.type !== operation.type) {
      return { opId, status: "rejected" };
    } else if (stored.tombstone) {
      // A deleted record never comes back, whatever is sent.
      return { opId, status: "deleted", currentRevision: stored.revision };
    } else if (stored.revision !== operation.baseRevision) {
      return { opId, status: "conflict", currentRevision: stored.revision };
    }
    const revision = (stored?.revision ?? 0) + 1;
    state.sequence += 1;
    state.records.set(operation.recordId, {
      type: operation.type,
      revision,
      sequence: state.sequence,
      schemaVersion: operation.schemaVersion,
      tombstone: operation.tombstone,
      payload: operation.tombstone ? null : operation.payload,
    });
    state.applied.set(opId, revision);
    return { opId, status: "applied", revision };
  }

  /**
   * Apply a batch of operations for an account, in order.
   *
   * @param owner - The account, as the real server takes it from the
   *   verified session.
   * @param operations - The batch.
   * @returns One result per operation, in the same order.
   */
  push(owner: string, operations: readonly SyncOperation[]): OperationResult[] {
    if (operations.length < 1 || operations.length > MAX_OPERATIONS_PER_BATCH) {
      throw new ApiError("unexpected");
    }
    const state = this.#owner(owner);
    return operations.map((operation) => this.#apply(state, operation));
  }

  /**
   * The account's records that changed after a cursor, oldest change first.
   *
   * @param owner - The account.
   * @param cursor - The last sequence the device has seen; `"0"` to start.
   * @returns One page.
   */
  pull(owner: string, cursor: string): ChangePage {
    const after = Number(cursor);
    if (!/^[0-9]+$/.test(cursor) || !Number.isSafeInteger(after)) {
      throw new ApiError("unexpected");
    }
    const changes: RemoteChange[] = [...this.#owner(owner).records.entries()]
      .filter(([, record]) => record.sequence > after)
      .sort(([, left], [, right]) => left.sequence - right.sequence)
      .map(([recordId, record]) => ({ recordId, ...record }));
    const page = changes.slice(0, this.pageSize);
    return {
      changes: page,
      nextCursor: String(page.at(-1)?.sequence ?? after),
      hasMore: changes.length > page.length,
    };
  }

  /**
   * A transport for one account's device.
   *
   * @param owner - Gives the account the device is signed in to, when asked.
   * @returns The transport.
   */
  transportFor(owner: () => string | Promise<string>): SyncTransport {
    const reach = async (): Promise<string> => {
      if (!this.reachable) {
        throw new ApiError("offline");
      }
      return owner();
    };
    return {
      push: async (operations) => this.push(await reach(), operations),
      pull: async (cursor) => this.pull(await reach(), cursor),
    };
  }
}
