import { describe, expect, it, vi } from "vitest";

import {
  IllegalTransitionError,
  createSession,
  type SessionEvent,
  type SessionState,
} from "../../../src/app/session";

const STATES: readonly SessionState[] = [
  "signed_out",
  "signed_in_locked",
  "unlocked",
];
const EVENTS: readonly SessionEvent[] = ["signIn", "unlock", "lock", "signOut"];

/** Every allowed transition; anything not listed must throw. */
const ALLOWED: Readonly<Record<string, SessionState>> = {
  "signed_out:signIn": "signed_in_locked",
  "signed_in_locked:unlock": "unlocked",
  "signed_in_locked:signOut": "signed_out",
  "unlocked:lock": "signed_in_locked",
  "unlocked:signOut": "signed_out",
};

describe("session state machine (DEV-005)", () => {
  it("starts signed out", () => {
    expect(createSession().state).toBe("signed_out");
  });

  for (const from of STATES) {
    for (const event of EVENTS) {
      const to = ALLOWED[`${from}:${event}`];
      if (to !== undefined) {
        it(`${event} moves ${from} to ${to}`, () => {
          const session = createSession(from);

          session[event]();

          expect(session.state).toBe(to);
        });
      } else {
        it(`${event} is refused while ${from}`, () => {
          const session = createSession(from);

          expect(() => {
            session[event]();
          }).toThrow(IllegalTransitionError);
          expect(session.state).toBe(from);
        });
      }
    }
  }

  it("names the state and the event in the error", () => {
    expect(() => {
      createSession().unlock();
    }).toThrow("Cannot unlock while signed_out");
  });

  it("locking keeps the user signed in (DEV-005)", () => {
    const session = createSession("unlocked");

    session.lock();

    expect(session.state).toBe("signed_in_locked");
  });

  it("notifies subscribers of each change until they unsubscribe", () => {
    const session = createSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    session.signIn();
    session.unlock();
    unsubscribe();
    session.lock();

    expect(listener.mock.calls).toEqual([["signed_in_locked"], ["unlocked"]]);
  });

  it("does not notify when a transition is refused", () => {
    const session = createSession();
    const listener = vi.fn();
    session.subscribe(listener);

    expect(() => {
      session.lock();
    }).toThrow(IllegalTransitionError);

    expect(listener).not.toHaveBeenCalled();
  });
});
