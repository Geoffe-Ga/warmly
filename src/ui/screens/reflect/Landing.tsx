import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  firstQuestion,
  type ReflectSession,
} from "../../../domain/reflect/types";
import { PageLayout } from "../../components/PageLayout";
import { JournalBrowser } from "../journal/Timeline";
import { useJournalEntries } from "../journal/shared";

/** The path part that means "a session not yet started". */
export const NEW_SESSION = "new";

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Follow the saved sessions.
 *
 * @returns The sessions, newest first; empty until they have been read.
 */
function useSessions(): readonly ReflectSession[] {
  const { reflect } = useServices();
  const [sessions, setSessions] = useState<readonly ReflectSession[]>([]);
  useEffect(() => {
    let current = true;
    const load = (): void => {
      void reflect.list().then((found) => {
        if (current) {
          setSessions(found);
        }
      });
    };
    load();
    const stop = reflect.subscribe(load);
    return () => {
      current = false;
      stop();
    };
  }, [reflect]);
  return sessions;
}

function SessionList(props: {
  readonly sessions: readonly ReflectSession[];
}): JSX.Element {
  if (props.sessions.length === 0) {
    return <p>You have no saved reflections yet.</p>;
  }
  return (
    <nav aria-label="Your reflections">
      <ul class="action-list">
        {props.sessions.map((session) => (
          <li key={session.id}>
            <Link
              href={pathFor("reflect-session", { id: session.id })}
              class="action"
            >
              Session from {DAY.format(new Date(session.createdAt))}
              <span class="action__detail">{firstQuestion(session)}</span>
              <span class="action__detail">
                {session.status === "finished" ? "Finished" : "Open"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Reflect: the way to ask a question of your own, the reflections already
 * saved, and the journal to look through (PRD RF-001, RF-002).
 *
 * Opening this screen, searching, or opening a saved reflection never
 * calls AI. The only way to is to write a question and agree to send it.
 * There are no suggested questions: the question is the person's own.
 *
 * @returns The Reflect landing screen.
 */
export function Landing(): JSX.Element {
  const sessions = useSessions();
  const journal = useJournalEntries();

  return (
    <PageLayout
      title="Reflect"
      lead="Ask your own question about your own journal. Nothing is sent anywhere until you ask and agree."
    >
      <nav aria-label="Start">
        <ul class="action-list">
          <li>
            <Link
              href={pathFor("reflect-session", { id: NEW_SESSION })}
              class="action"
            >
              Ask a question
            </Link>
          </li>
        </ul>
      </nav>
      <section aria-labelledby="reflect-saved">
        <h2 id="reflect-saved">Your reflections</h2>
        <SessionList sessions={sessions} />
      </section>
      <section class="stack" aria-labelledby="reflect-journal">
        <h2 id="reflect-journal">Your journal</h2>
        <JournalBrowser journal={journal} hasDraft={false} />
      </section>
    </PageLayout>
  );
}
