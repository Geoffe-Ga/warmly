/**
 * Domain events: things that happened to private records, announced so that
 * other parts of the app can react without the code that caused them
 * knowing who is listening (PRD DEP-001).
 *
 * Events stay on this device and in memory. An event carries IDs and
 * hashes, never what a record says.
 *
 * An event is announced after the change it describes has been stored, and
 * at most once: if the app stops in between, or a listener fails, it is not
 * announced again. So a listener must not be the only thing that keeps
 * dependent records right. Whatever depends on an entry stores that entry's
 * content hash and checks it again when the app is unlocked.
 */

/** Every event, and what it carries. */
export interface DomainEvents {
  /** What a completed journal entry says has changed. */
  readonly "journal.changed": {
    readonly entryId: string;
    /** The content hash before the change. */
    readonly oldHash: string;
    /** The content hash after it. Never equal to `oldHash`. */
    readonly newHash: string;
  };
  /** A completed journal entry has been deleted for good. */
  readonly "journal.deleted": {
    readonly entryId: string;
    /** The content hash the entry had when it was deleted. */
    readonly oldHash: string;
  };
}

/** The name of an event. */
export type DomainEventType = keyof DomainEvents;

/** Reacts to one kind of event. May do asynchronous work. */
export type DomainEventListener<K extends DomainEventType> = (
  event: DomainEvents[K],
) => void | Promise<void>;

/** Announces events to whoever has asked to hear them. */
export interface EventBus {
  /**
   * Ask to hear one kind of event.
   *
   * @param type - The event's name.
   * @param listener - Called with each such event.
   * @returns A function that stops the listener being called.
   */
  on<K extends DomainEventType>(
    type: K,
    listener: DomainEventListener<K>,
  ): () => void;
  /**
   * Announce an event and wait for every listener to finish.
   *
   * It never rejects. By the time an event is announced the change it
   * describes is already stored, so a listener that fails must not make the
   * change look as if it failed. Every listener is run, whatever the others
   * do, and what failed is handed back.
   *
   * @param type - The event's name.
   * @param event - What happened.
   * @returns What each failed listener threw; empty when all succeeded.
   */
  emit<K extends DomainEventType>(
    type: K,
    event: DomainEvents[K],
  ): Promise<readonly unknown[]>;
}

/**
 * Create an event bus with no listeners.
 *
 * @returns The bus.
 */
export function createEventBus(): EventBus {
  const listeners: {
    [K in DomainEventType]: Set<DomainEventListener<K>>;
  } = { "journal.changed": new Set(), "journal.deleted": new Set() };

  return {
    on(type, listener) {
      listeners[type].add(listener);
      return () => {
        listeners[type].delete(listener);
      };
    },
    async emit(type, event) {
      const outcomes = await Promise.allSettled(
        // Each listener starts inside a promise, so one that throws at once
        // is counted as failed and does not stop the rest being called.
        [...listeners[type]].map((listener) =>
          Promise.resolve().then(() => listener(event)),
        ),
      );
      return outcomes
        .filter((outcome) => outcome.status === "rejected")
        .map((outcome) => outcome.reason as unknown);
    },
  };
}
