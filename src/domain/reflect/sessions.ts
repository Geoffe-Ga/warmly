/**
 * Where Reflect sessions are kept (PRD RF-001, RF-006).
 *
 * For now they are held in memory only: a lock or a reload forgets them.
 * Saving them as private records arrives next; the screens will not
 * change, because they only know this interface.
 *
 * Nothing here calls AI. A session is given a question and its answer
 * together, after the answer has been checked.
 */
import type { ReflectionAnswer } from "../../ai/contracts";
import type { ReflectSession } from "./types";

/** A question and the checked answer it got. */
export interface Exchange {
  readonly question: string;
  readonly answer: ReflectionAnswer;
}

/** Reads and adds to the person's Reflect sessions. */
export interface ReflectSessions {
  /** @returns Every session, newest first. */
  list(): Promise<readonly ReflectSession[]>;
  /** @returns The session, or `undefined` if there is none with that ID. */
  get(id: string): Promise<ReflectSession | undefined>;
  /**
   * Start a session with its first question and answer.
   *
   * @returns The new session.
   */
  start(exchange: Exchange, now?: Date): Promise<ReflectSession>;
  /**
   * Add a question and its answer to an active session.
   *
   * @returns The session, or `undefined` if it is not here or is finished.
   */
  add(
    id: string,
    exchange: Exchange,
    now?: Date,
  ): Promise<ReflectSession | undefined>;
  /**
   * Be told when sessions change.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void;
  /** Forget everything. Called when the app locks. */
  lock(): void;
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

/** Sessions held in memory. */
export class MemoryReflectSessions implements ReflectSessions {
  #sessions = new Map<string, ReflectSession>();
  readonly #listeners = new Set<() => void>();

  #changed(): void {
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  list(): Promise<readonly ReflectSession[]> {
    return Promise.resolve(
      [...this.#sessions.values()].sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      ),
    );
  }

  get(id: string): Promise<ReflectSession | undefined> {
    return Promise.resolve(this.#sessions.get(id));
  }

  start(exchange: Exchange, now: Date = new Date()): Promise<ReflectSession> {
    const at = now.toISOString();
    const session: ReflectSession = {
      id: crypto.randomUUID(),
      status: "active",
      messages: turns(exchange, at),
      createdAt: at,
      updatedAt: at,
    };
    this.#sessions.set(session.id, session);
    this.#changed();
    return Promise.resolve(session);
  }

  add(
    id: string,
    exchange: Exchange,
    now: Date = new Date(),
  ): Promise<ReflectSession | undefined> {
    const existing = this.#sessions.get(id);
    if (existing?.status !== "active") {
      return Promise.resolve(undefined);
    }
    const at = now.toISOString();
    const session: ReflectSession = {
      ...existing,
      messages: [...existing.messages, ...turns(exchange, at)],
      updatedAt: at,
    };
    this.#sessions.set(id, session);
    this.#changed();
    return Promise.resolve(session);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  lock(): void {
    this.#sessions = new Map();
    this.#changed();
  }
}
