import type { JSX } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";

import type { ReflectionAnswer } from "../../../ai/contracts";
import type { ReflectRequest } from "../../../ai/provider";
import { AiRequestController } from "../../../ai/request-controller";
import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import type { JournalEntry } from "../../../domain/journal/types";
import {
  InvalidQuestionError,
  MAX_QUESTION,
  reflectRequest,
} from "../../../domain/reflect/request";
import type { ReflectSession } from "../../../domain/reflect/types";
import {
  AiRequestStatus,
  useAiRequest,
} from "../../components/AiRequestStatus";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CitedAnswer } from "../../components/CitedAnswer";
import { TextArea } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { useJournalEntries } from "../journal/shared";
import { NEW_SESSION } from "./Landing";

/** Said when the question box is empty or the question is too long. */
export const QUESTION_NEEDED = `Write your question first, up to ${MAX_QUESTION.toLocaleString("en-US")} characters.`;

/** Said when there is no finished entry to ask about. */
export const NOTHING_TO_ASK_ABOUT =
  "You have no finished journal entries yet, so there is nothing to ask about. Write an entry first.";

/** What the screen knows about the session it was asked for. */
type Found =
  | { readonly kind: "loading" }
  | { readonly kind: "new" }
  | { readonly kind: "missing" }
  | { readonly kind: "session"; readonly session: ReflectSession };

function useSession(id: string | undefined): Found {
  const { reflect } = useServices();
  const [found, setFound] = useState<Found>({ kind: "loading" });
  useEffect(() => {
    if (id === NEW_SESSION) {
      setFound({ kind: "new" });
      return undefined;
    }
    let current = true;
    const load = (): void => {
      void (
        id === undefined ? Promise.resolve(undefined) : reflect.get(id)
      ).then((session) => {
        if (current) {
          setFound(
            session === undefined
              ? { kind: "missing" }
              : { kind: "session", session },
          );
        }
      });
    };
    load();
    const stop = reflect.subscribe(load);
    return () => {
      current = false;
      stop();
    };
  }, [reflect, id]);
  return found;
}

function Messages(props: {
  readonly session: ReflectSession;
  readonly entries: readonly JournalEntry[];
}): JSX.Element {
  return (
    <>
      {props.session.messages.map((message) =>
        message.role === "question" ? (
          <Card key={message.id} heading="You asked">
            <p class="card-reading">{message.text}</p>
          </Card>
        ) : (
          <Card key={message.id} heading="Answer">
            <CitedAnswer answer={message.answer} entries={props.entries} />
          </Card>
        ),
      )}
    </>
  );
}

/**
 * The box to write a question in, and everything about sending it. The
 * question stays in the box through a failure or a cancel.
 */
function Ask(props: {
  readonly session: ReflectSession | undefined;
  readonly entries: readonly JournalEntry[];
  readonly ready: boolean;
}): JSX.Element {
  const { ai, reflect } = useServices();
  const { navigate } = useContext(NavigationContext);
  const [question, setQuestion] = useState("");
  const [problem, setProblem] = useState<string>();
  const controller = useMemo(
    () =>
      new AiRequestController<ReflectRequest, ReflectionAnswer>(
        (request, consent, signal) => ai.reflect(request, consent, signal),
      ),
    [ai],
  );
  const state = useAiRequest(controller);
  const sessionId = props.session?.id;

  // Leaving the screen, or locking, stops a request and forgets it.
  useEffect(
    () => () => {
      controller.reset();
    },
    [controller],
  );

  // A checked answer is stored with its question, then shown in the
  // session. Storing calls nothing: the answer is already here.
  useEffect(() => {
    if (state.phase !== "done") {
      return;
    }
    const exchange = { question: state.request.question, answer: state.result };
    controller.reset();
    setQuestion("");
    void (
      sessionId === undefined
        ? reflect.start(exchange)
        : reflect.add(sessionId, exchange)
    ).then((stored) => {
      if (stored !== undefined && stored.id !== sessionId) {
        navigate(pathFor("reflect-session", { id: stored.id }));
      }
    });
  }, [state, controller, reflect, sessionId, navigate]);

  const busy = state.phase === "running" || state.phase === "awaiting-consent";
  const hasEntries = props.entries.some((entry) => entry.status === "complete");

  return (
    <Card heading={props.session === undefined ? "Your question" : "Ask more"}>
      <form
        class="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setProblem(undefined);
          if (!hasEntries) {
            setProblem(NOTHING_TO_ASK_ABOUT);
            return;
          }
          try {
            // Nothing is sent here: this opens the dialog that asks first.
            controller.ask(reflectRequest(question, props.entries));
          } catch (error) {
            if (!(error instanceof InvalidQuestionError)) {
              throw error;
            }
            setProblem(QUESTION_NEEDED);
          }
        }}
      >
        <TextArea
          label="What would you like to ask about your journal?"
          hint="In your own words. Your finished entries are sent with it, to the AI provider you connected, only after you agree."
          value={question}
          onInput={setQuestion}
          rows={3}
        />
        {problem !== undefined && (
          <StatusBanner tone="error" label="Not sent">
            {problem}
          </StatusBanner>
        )}
        <div class="button-row">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !props.ready}
          >
            Ask
          </Button>
        </div>
      </form>
      <AiRequestStatus controller={controller} />
    </Card>
  );
}

/**
 * One reflection: the questions asked and the answers given, each answer
 * with links to the entries it rests on, and a box to ask more (PRD
 * RF-001 to RF-005; AC-07).
 *
 * Opening a reflection never calls AI. An answer is asked for only when
 * the person writes a question, presses Ask and agrees in the dialog that
 * says what will be sent and to whom. A new reflection is stored once its
 * first answer has arrived and been checked.
 *
 * @param props - The route's parameters; `id` names the session, or is
 *   `new` for one not yet started.
 * @returns The session screen.
 */
export function Session(props: { readonly params: RouteParams }): JSX.Element {
  const found = useSession(props.params["id"]);
  const journal = useJournalEntries();
  const entries = journal.state === "ready" ? journal.entries : [];
  const session = found.kind === "session" ? found.session : undefined;

  return (
    <PageLayout title="Reflection">
      {found.kind === "loading" && (
        <StatusBanner tone="info" label="Loading">
          Getting your reflection.
        </StatusBanner>
      )}
      {found.kind === "missing" && (
        <StatusBanner tone="info" label="Not here">
          This reflection isn't on this device. Reflections are not kept after
          the app locks yet.
        </StatusBanner>
      )}
      {journal.state === "failed" && (
        <StatusBanner tone="error" label="Couldn't open your journal">
          {journal.message}
        </StatusBanner>
      )}
      {session !== undefined && (
        <Messages session={session} entries={entries} />
      )}
      {(found.kind === "new" || session?.status === "active") && (
        <Ask
          // A different session starts with an empty box.
          key={session?.id ?? NEW_SESSION}
          session={session}
          entries={entries}
          ready={journal.state === "ready"}
        />
      )}
      <p>
        <Link href={pathFor("reflect")}>Back to Reflect</Link>
      </p>
    </PageLayout>
  );
}
