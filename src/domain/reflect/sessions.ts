/**
 * Where Reflect sessions are kept, and the few things that can happen to
 * one (PRD RF-006, RF-007, RF-008, DEP-002; AC-08).
 *
 * A session and all of its questions and answers are **one** private
 * record: sealed on this device, kept in the encrypted record store and
 * synced to the person's other devices. One record keeps a conversation
 * whole under sync, and makes deleting it a single deletion.
 *
 * A session is `active` until the person finishes it. That is the only
 * change of state there is, and nothing but the person's own action makes
 * it: not leaving the screen, not locking, not time passing. A finished
 * session can be read and deleted, and never asked more.
 *
 * Nothing here calls AI. A session is given a question and its answer
 * together, after the answer has been checked. Finishing writes no summary.
 */
import type { ReflectionAnswer } from "../../ai/contracts";
import type { RecordStore } from "../../storage/record-store";
import type { ReflectSession } from "./types";

/** A question and the checked answer it got. */
export interface Exchange {
  readonly question: string;
  readonly answer: ReflectionAnswer;
}

/** The session is finished, so nothing more can be added to it. */
export class SessionFinishedError extends Error {
  constructor() {
    super("A finished reflection cannot be added to");
    this.name = "SessionFinishedError";
  }
}

/** Reads and changes the person's Reflect sessions. */
export interface ReflectSessions {
  /** @returns Every session, newest first. */
  list(): Promise<readonly ReflectSession[]>;
  /** @returns The session, or `undefined` if there is none with that ID. */
  get(id: string): Promise<ReflectSession | undefined>;
  /**
   * Start a session with its first question and answer.
   *
   * @returns The new session, which is active.
   */
  start(exchange: Exchange, now?: Date): Promise<ReflectSession>;
  /**
   * Add a question and its answer to an active session.
   *
   * @returns The session, or `undefined` if it is not here.
   * @throws SessionFinishedError if the session is finished. Nothing is
   *   stored.
   */
  add(
    id: string,
    exchange: Exchange,
    now?: Date,
  ): Promise<ReflectSession | undefined>;
  /**
   * Finish a session: from then on it can be read but not added to. There
   * is no way back. Finishing calls no AI and adds nothing to the session.
   *
   * @returns The finished session, or `undefined` if it is not here.
   *   Finishing one that is already finished changes nothing.
   */
  finish(id: string, now?: Date): Promise<ReflectSession | undefined>;
  /**
   * Delete a session and everything in it, for good. The caller asks the
   * person first.
   *
   * @returns Whether there was a session to delete.
   */
  remove(id: string): Promise<boolean>;
  /**
   * Be told when sessions may have changed, here or through sync.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
}

function turns(exchange: Exchange, at: string): ReflectSession["messages"] {
  return [
    {
      id: crypto.randomUUID(),
      role: "question",
      text: exchange.question,
      at,
    },
    {
      id: crypto.randomUUID(),
      role: "answer",
      answer: exchange.answer,
      at,
    },
  ];
}

/** The sessions the app uses: a view of the private record store. */
export class RecordReflectSessions implements ReflectSessions {
  readonly #records: RecordStore;

  /** @param records - The private record store. */
  constructor(records: RecordStore) {
    this.#records = records;
  }

  async list(): Promise<readonly ReflectSession[]> {
    const all = await this.#records.list("reflect-session");
    return [...all].sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
  }

  get(id: string): Promise<ReflectSession | undefined> {
    return this.#records.get("reflect-session", id);
  }

  async start(
    exchange: Exchange,
    now: Date = new Date(),
  ): Promise<ReflectSession> {
    const at = now.toISOString();
    const session: ReflectSession = {
      id: crypto.randomUUID(),
      status: "active",
      messages: turns(exchange, at),
      createdAt: at,
      updatedAt: at,
    };
    await this.#records.put("reflect-session", session);
    return session;
  }

  async add(
    id: string,
    exchange: Exchange,
    now: Date = new Date(),
  ): Promise<ReflectSession | undefined> {
    const existing = await this.get(id);
    if (existing === undefined) {
      return undefined;
    }
    if (existing.status === "finished") {
      throw new SessionFinishedError();
    }
    const at = now.toISOString();
    const session: ReflectSession = {
      ...existing,
      messages: [...existing.messages, ...turns(exchange, at)],
      updatedAt: at,
    };
    await this.#records.put("reflect-session", session);
    return session;
  }

  async finish(
    id: string,
    now: Date = new Date(),
  ): Promise<ReflectSession | undefined> {
    const existing = await this.get(id);
    if (existing === undefined || existing.status === "finished") {
      return existing;
    }
    const finished: ReflectSession = {
      ...existing,
      status: "finished",
      updatedAt: now.toISOString(),
    };
    await this.#records.put("reflect-session", finished);
    return finished;
  }

  async remove(id: string): Promise<boolean> {
    if ((await this.get(id)) === undefined) {
      return false;
    }
    await this.#records.delete("reflect-session", id);
    return true;
  }

  subscribe(listener: () => void): () => void {
    return this.#records.subscribe(listener);
  }
}
