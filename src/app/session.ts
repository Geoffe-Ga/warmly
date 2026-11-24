/**
 * The account session state machine (PRD DEV-005).
 *
 * Three explicit states and four transitions. Private screens render only in
 * `unlocked`; everything else about access follows from the state, so there is
 * one place to reason about what a locked or signed-out app may show.
 *
 * ```
 * signed_out ──signIn──▶ signed_in_locked ──unlock──▶ unlocked
 *      ▲                    │        ▲                   │
 *      └──────signOut───────┘        └───────lock────────┘
 *      └──────────────────signOut────────────────────────┘
 * ```
 */

/** Where the user is in the account lifecycle. */
export type SessionState = "signed_out" | "signed_in_locked" | "unlocked";

/** A transition the state machine supports. */
export type SessionEvent = "signIn" | "unlock" | "lock" | "signOut";

/** Thrown when a transition is not allowed from the current state. */
export class IllegalTransitionError extends Error {
  constructor(from: SessionState, event: SessionEvent) {
    super(`Cannot ${event} while ${from}`);
    this.name = "IllegalTransitionError";
  }
}

const TRANSITIONS: Readonly<
  Record<SessionState, Partial<Record<SessionEvent, SessionState>>>
> = {
  signed_out: { signIn: "signed_in_locked" },
  signed_in_locked: { unlock: "unlocked", signOut: "signed_out" },
  unlocked: { lock: "signed_in_locked", signOut: "signed_out" },
};

/** The session: its current state, its transitions, and change notification. */
export interface Session {
  readonly state: SessionState;
  /** The user authenticated. Their data is still locked. */
  signIn(): void;
  /** The root key is available in memory. */
  unlock(): void;
  /** Keys were dropped from memory; the user stays signed in. */
  lock(): void;
  /** The user signed out; nothing of theirs may be shown. */
  signOut(): void;
  /**
   * Be told after every state change.
   *
   * @param listener - Called with the new state.
   * @returns A function that stops the notifications.
   */
  subscribe(listener: (state: SessionState) => void): () => void;
}

/**
 * Create a session.
 *
 * @param initial - The starting state; a fresh app starts signed out.
 * @returns The session.
 */
export function createSession(initial: SessionState = "signed_out"): Session {
  let state = initial;
  const listeners = new Set<(state: SessionState) => void>();

  const apply = (event: SessionEvent): void => {
    const next = TRANSITIONS[state][event];
    if (next === undefined) {
      throw new IllegalTransitionError(state, event);
    }
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  };

  return {
    get state() {
      return state;
    },
    signIn: () => {
      apply("signIn");
    },
    unlock: () => {
      apply("unlock");
    },
    lock: () => {
      apply("lock");
    },
    signOut: () => {
      apply("signOut");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
