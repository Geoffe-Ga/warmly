import type { JSX } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "preact/hooks";

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
import {
  SessionFinishedError,
  type Exchange,
  type ReflectSessions,
} from "../../../domain/reflect/sessions";
import type { ReflectSession } from "../../../domain/reflect/types";
import {
  AiRequestStatus,
  useAiRequest,
} from "../../components/AiRequestStatus";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CitedAnswer } from "../../components/CitedAnswer";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextArea } from "../../components/Field";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { describeStorageError } from "../../storage-messages";
import { DELETE_WARNING } from "../journal/Entry";
import { useJournalEntries } from "../journal/shared";
import { NEW_SESSION } from "./Landing";

/** Said when the question box is empty or the question is too long. */
export const QUESTION_NEEDED = `Write your question first, up to ${MAX_QUESTION.toLocaleString("en-US")} characters.`;

/** Said when there is no finished entry to ask about. */
export const NOTHING_TO_ASK_ABOUT =
  "You have no finished journal entries yet, so there is nothing to ask about. Write an entry first.";

/** Said when an answer arrived but could not be stored. */
export const ANSWER_NOT_SAVED =
  "The answer arrived, but Warmly couldn't save it on this device. It is shown below. Nothing was sent again. Keep this page open and try saving it.";

/** Said when a reflection was finished elsewhere while an answer was on its way. */
export const SAVED_ELSEWHERE =
  "That reflection was finished on another device while you were asking, so your question and its answer were saved as a new reflection.";

/**
 * Store a question and its answer: in the session it was asked in, or in a
 * new one if there is none, or if that one has gone or was finished
 * meanwhile on another device. The answer is never thrown away.
 */
async function storeExchange(
  reflect: ReflectSessions,
  sessionId: string | undefined,
  exchange: Exchange,
): Promise<{ session: ReflectSession; elsewhere: boolean }> {
  if (sessionId === undefined) {
    return { session: await reflect.start(exchange), elsewhere: false };
  }
  try {
    const added = await reflect.add(sessionId, exchange);
    if (added !== undefined) {
      return { session: added, elsewhere: false };
    }
  } catch (error) {
    if (!(error instanceof SessionFinishedError)) {
      throw error;
    }
  }
  return { session: await reflect.start(exchange), elsewhere: true };
}

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

  // An answer that has arrived but is not stored yet. It is kept here, on
  // screen, until it is: an answer the person paid for is never dropped.
  const [unsaved, setUnsaved] = useState<Exchange>();
  const [saveProblem, setSaveProblem] = useState<string>();
  const [note, setNote] = useState("");

  /** Store an answer with its question. Calls nothing: it is already here. */
  const save = useCallback(
    async (exchange: Exchange): Promise<void> => {
      setSaveProblem(undefined);
      try {
        const stored = await storeExchange(reflect, sessionId, exchange);
        setUnsaved(undefined);
        setQuestion("");
        if (stored.elsewhere) {
          setNote(SAVED_ELSEWHERE);
        }
        if (stored.session.id !== sessionId) {
          navigate(pathFor("reflect-session", { id: stored.session.id }));
        }
      } catch (error) {
        // Never the error's own text.
        setSaveProblem(describeStorageError(error, "save") ?? ANSWER_NOT_SAVED);
      }
    },
    [reflect, sessionId, navigate],
  );

  useEffect(() => {
    if (state.phase !== "done") {
      return;
    }
    const exchange = { question: state.request.question, answer: state.result };
    controller.reset();
    setUnsaved(exchange);
    void save(exchange);
  }, [state, controller, save]);

  const busy =
    state.phase === "running" ||
    state.phase === "awaiting-consent" ||
    unsaved !== undefined;
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
      {note !== "" && (
        <p role="status" class="hint">
          {note}
        </p>
      )}
      {unsaved !== undefined && saveProblem !== undefined && (
        <>
          <StatusBanner tone="error" label="Answer not saved yet">
            {saveProblem}
            <div class="button-row">
              <Button
                onClick={() => {
                  void save(unsaved);
                }}
              >
                Save the answer
              </Button>
            </div>
          </StatusBanner>
          <CitedAnswer answer={unsaved.answer} entries={props.entries} />
        </>
      )}
    </Card>
  );
}

/** Said when a reflection is finished and can only be read. */
export const FINISHED =
  "This reflection is finished. You can read it, but not add to it. To ask something else, start a new one.";

/** Asked before a reflection is finished. */
export const FINISH_EXPLAINED =
  "A finished reflection stays here to read, but you can't ask more in it, and it can't be opened again for questions. Nothing is sent anywhere when you finish.";

/** Finish and Delete for one reflection. */
function Manage(props: {
  readonly session: ReflectSession;
  readonly onDeleted: () => void;
}): JSX.Element {
  const { reflect } = useServices();
  const { session } = props;
  const [asking, setAsking] = useState<"finish" | "delete">();
  const [problem, setProblem] = useState(false);
  const act = (work: () => Promise<unknown>): void => {
    setAsking(undefined);
    setProblem(false);
    work().catch(() => {
      setProblem(true);
    });
  };

  return (
    <Card heading={session.status === "active" ? "Finish or delete" : "Delete"}>
      {problem && (
        <StatusBanner tone="error" label="Not saved">
          Warmly couldn't save that. Nothing was changed. Try again in a moment.
        </StatusBanner>
      )}
      <div class="button-row">
        {session.status === "active" && (
          <Button
            onClick={() => {
              setAsking("finish");
            }}
          >
            Finish Reflection
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => {
            setAsking("delete");
          }}
        >
          Delete this reflection
        </Button>
      </div>
      <ConfirmDialog
        open={asking === "finish"}
        title="Finish this reflection?"
        confirmLabel="Finish Reflection"
        onCancel={() => {
          setAsking(undefined);
        }}
        onConfirm={() => {
          act(() => reflect.finish(session.id));
        }}
      >
        <p>{FINISH_EXPLAINED}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "delete"}
        title="Delete this reflection?"
        confirmLabel="Delete reflection"
        destructive
        onCancel={() => {
          setAsking(undefined);
        }}
        onConfirm={() => {
          act(async () => {
            await reflect.remove(session.id);
            props.onDeleted();
          });
        }}
      >
        <p>
          Its questions and answers are deleted. Your journal entries are not.
        </p>
        <p>{DELETE_WARNING}</p>
      </ConfirmDialog>
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
 * A reflection stays open until the person presses Finish Reflection:
 * leaving the screen or the app does not finish it (RF-007). A finished
 * one can be read but not added to. Either kind can be deleted for good,
 * after a confirmation. Finishing and deleting call no AI.
 *
 * @param props - The route's parameters; `id` names the session, or is
 *   `new` for one not yet started.
 * @returns The session screen.
 */
export function Session(props: { readonly params: RouteParams }): JSX.Element {
  const found = useSession(props.params["id"]);
  const journal = useJournalEntries();
  const entries = journal.state === "ready" ? journal.entries : [];
  const [deleted, setDeleted] = useState(false);
  const session =
    found.kind === "session" && !deleted ? found.session : undefined;

  useEffect(() => {
    // The button that had focus has gone with the reflection.
    if (deleted) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [deleted]);

  return (
    <PageLayout title="Reflection">
      {(found.kind === "loading" ||
        (session !== undefined && journal.state === "loading")) && (
        <StatusBanner tone="info" label="Loading">
          Getting your reflection.
        </StatusBanner>
      )}
      {deleted && (
        <StatusBanner tone="success" label="Deleted">
          The reflection has been removed from this device.
        </StatusBanner>
      )}
      {found.kind === "missing" && !deleted && (
        <StatusBanner tone="info" label="Not here">
          This reflection isn't on this device. It may have been deleted.
        </StatusBanner>
      )}
      {journal.state === "failed" && (
        <StatusBanner tone="error" label="Couldn't open your journal">
          {journal.message}
        </StatusBanner>
      )}
      {/* Saved answers wait for the journal: until it has loaded, an entry
          that is here would be shown as "no longer on this device". */}
      {session !== undefined && journal.state === "ready" && (
        <Messages session={session} entries={entries} />
      )}
      {session?.status === "finished" && (
        <StatusBanner tone="info" label="Finished">
          {FINISHED}
        </StatusBanner>
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
      {session !== undefined && (
        <Manage
          session={session}
          onDeleted={() => {
            setDeleted(true);
          }}
        />
      )}
      <p>
        <Link href={pathFor("reflect")}>Back to Reflect</Link>
      </p>
    </PageLayout>
  );
}
