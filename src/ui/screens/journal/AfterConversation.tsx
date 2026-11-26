import type { JSX } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import { NavigationContext } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  createAfter,
  deleteAfter,
  editAfter,
} from "../../../domain/post-conversation/service";
import {
  AFTER_PROMPTS,
  canSaveAfter,
  type AfterResponses,
  type PostConversationReflection,
} from "../../../domain/post-conversation/types";
import { StaleRecordError } from "../../../storage/record-store";
import { Button } from "../../components/Button";
import { DangerZone } from "../../components/DangerZone";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextArea } from "../../components/Field";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ActionForm, useAction } from "../../components/ActionForm";
import { DependentsWarning } from "./dependents";
import { DELETE_WARNING, formatEntryDate } from "./shared";

/** The path part that means "one not yet written". */
export const NEW_AFTER = "new";

/** Said when Save is pressed with nothing written. */
export const NOTHING_WRITTEN =
  "Write something in at least one of the three boxes first. You can leave the others empty.";

/** Said under the heading of the form. */
export const AFTER_LEAD =
  "For after a conversation you have had. It is separate from your journal entries, only you can read it, and every question is optional. If Warmly locks while you are writing, what you have typed is saved as it is, so nothing is lost; you can change or delete it afterwards.";

/** Said when the copy on screen is older than the stored one. */
export const AFTER_OUT_OF_DATE =
  "This was changed somewhere else, for example in another tab, so it was not saved. What you typed is still here. Copy anything you want to keep, then load the newer version.";

const EMPTY: AfterResponses = { went_well: "", difficult: "", remember: "" };

/** What the screen has found out about the reflection it was asked for. */
type Found =
  | { readonly kind: "loading" }
  | { readonly kind: "new" }
  | { readonly kind: "missing" }
  | { readonly kind: "deleted" }
  | { readonly kind: "here"; readonly record: PostConversationReflection };

function useAfter(id: string | undefined): [Found, (found: Found) => void] {
  const { records } = useServices();
  const [found, setFound] = useState<Found>(
    id === NEW_AFTER ? { kind: "new" } : { kind: "loading" },
  );
  useEffect(() => {
    if (id === NEW_AFTER || id === undefined) {
      setFound(id === NEW_AFTER ? { kind: "new" } : { kind: "missing" });
      return undefined;
    }
    let current = true;
    void records.get("post-conversation", id).then(
      (record) => {
        if (current) {
          setFound(
            record === undefined
              ? { kind: "missing" }
              : { kind: "here", record },
          );
        }
      },
      () => {
        if (current) {
          setFound({ kind: "missing" });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [records, id]);
  return [found, setFound];
}

/** The three boxes, and saving what is in them. */
function AfterForm(props: {
  readonly record: PostConversationReflection | undefined;
  readonly onDeleted: () => void;
}): JSX.Element {
  const { records, lockHooks } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [record, setRecord] = useState(props.record);
  const [responses, setResponses] = useState<AfterResponses>(
    props.record?.responses ?? EMPTY,
  );
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const [outOfDate, setOutOfDate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const empty = !canSaveAfter(responses);
  // What is typed here needs the keys to be saved, so it is saved before
  // they are dropped when the app locks (ADR-0004). An empty or unchanged
  // form has nothing to save. What is saved this way is an ordinary note,
  // which the person can change or delete: there is no draft of a note,
  // and the other choice would be to lose what they typed. The page says
  // so (`AFTER_LEAD`).
  const latest = useRef<{
    record: PostConversationReflection | undefined;
    responses: AfterResponses;
    changed: boolean;
    empty: boolean;
  }>({ record: props.record, responses, changed: false, empty });
  const changed =
    record === undefined
      ? !empty
      : AFTER_PROMPTS.some(
          (prompt) => responses[prompt.key] !== record.responses[prompt.key],
        );

  // A save that is on its way, first or later. The lock hook waits for it
  // instead of writing the same words a second time.
  const saving = useRef<Promise<PostConversationReflection> | undefined>(
    undefined,
  );

  const save = async (): Promise<void> => {
    const stored =
      record === undefined
        ? createAfter(records, responses)
        : // Refused if the note has changed under the form meanwhile, by
          // sync or in another tab: it is never replaced unseen.
          editAfter(records, record.id, responses, {
            seen: record,
          });
    saving.current = stored;
    try {
      const now = await stored;
      // From here on these words are stored: there is nothing left for
      // the lock hook to save, even before this screen is shown again.
      latest.current = { record: now, responses, changed: false, empty };
      setRecord(now);
      if (record === undefined) {
        navigate(pathFor("after-conversation", { id: now.id }));
      } else {
        setSaved(true);
      }
    } catch (error) {
      if (!(error instanceof StaleRecordError)) {
        throw error;
      }
      setOutOfDate(true);
    } finally {
      // Only if no later save has started meanwhile.
      if (saving.current === stored) {
        saving.current = undefined;
      }
    }
  };

  useEffect(() => {
    latest.current = { record, responses, changed, empty };
  }, [record, responses, changed, empty]);
  useEffect(
    () =>
      lockHooks.register(async () => {
        if (saving.current !== undefined) {
          // Save was pressed and is still storing these words.
          await saving.current.catch(() => undefined);
        }
        const now = latest.current;
        if (!now.changed || now.empty) {
          return;
        }
        if (now.record === undefined) {
          await createAfter(records, now.responses);
          return;
        }
        try {
          await editAfter(records, now.record.id, now.responses, {
            seen: now.record,
          });
        } catch (error) {
          if (!(error instanceof StaleRecordError)) {
            throw error;
          }
          // The note was changed somewhere else, so nothing is written
          // over it. The keys are about to go and this screen with them,
          // so what was typed is kept as a note of its own, never lost.
          await createAfter(records, now.responses);
        }
      }),
    [lockHooks, records],
  );

  return (
    <>
      {outOfDate && (
        <StatusBanner tone="warning" label="Not saved">
          {AFTER_OUT_OF_DATE}
          <div class="button-row">
            <Button
              disabled={action.busy}
              onClick={() => {
                action.run(async () => {
                  const newer =
                    record === undefined
                      ? undefined
                      : await records.reload("post-conversation", record.id);
                  if (newer !== undefined) {
                    setRecord(newer);
                    setResponses(newer.responses);
                  }
                  setOutOfDate(false);
                });
              }}
            >
              Load the newer version
            </Button>
          </div>
        </StatusBanner>
      )}
      {record !== undefined && (
        <DependentsWarning entryId={record.id} doing="edit" what="after" />
      )}
      <ActionForm
        action={action}
        validate={() => {
          setTried(true);
          setSaved(false);
          return !empty;
        }}
        onValid={save}
      >
        {tried && empty && (
          <StatusBanner tone="error" label="Not saved">
            {NOTHING_WRITTEN}
          </StatusBanner>
        )}
        {AFTER_PROMPTS.map((prompt) => (
          <TextArea
            key={prompt.key}
            label={prompt.label}
            hint="Optional."
            rows={4}
            value={responses[prompt.key]}
            onInput={(value) => {
              setSaved(false);
              setResponses((was) => ({ ...was, [prompt.key]: value }));
            }}
          />
        ))}
        <p role="status" class="save-status">
          {saved && !changed ? "Saved on this device." : ""}
        </p>
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            {record === undefined ? "Save" : "Save changes"}
          </Button>
        </div>
      </ActionForm>
      {record !== undefined && (
        <DangerZone>
          <div class="button-row">
            <Button
              variant="danger"
              disabled={action.busy}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete this
            </Button>
          </div>
        </DangerZone>
      )}
      {record !== undefined && (
        <ConfirmDialog
          open={confirming}
          title="Delete this for good?"
          confirmLabel="Delete"
          cancelLabel="Keep it"
          destructive
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            action.run(async () => {
              await deleteAfter(records, record.id);
              props.onDeleted();
            });
          }}
        >
          <p>{DELETE_WARNING}</p>
          <DependentsWarning entryId={record.id} doing="delete" what="after" />
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * A reflection written after a conversation: three optional questions, in
 * a form of its own (PRD PC-001 to PC-003). It is opened only by the
 * person choosing to, from the journal. Nothing opens it for them: not
 * leaving presentation, not finishing a collection, not a reminder. It is
 * never a journal entry and is never shown as one. Writing, changing and
 * deleting it call no AI.
 *
 * @param props - The route's parameters; `id` names the reflection, or is
 *   `new` for one not yet written.
 * @returns The screen.
 */
export function AfterConversation(props: {
  readonly params: RouteParams;
}): JSX.Element {
  const id = props.params["id"];
  const [found, setFound] = useAfter(id);
  const deleted = found.kind === "deleted";

  useEffect(() => {
    // The button that had focus has gone with what was deleted.
    if (deleted) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [deleted]);

  const back = { href: pathFor("journal"), label: "Back to your journal" };
  if (found.kind === "loading") {
    return (
      <PageLayout back={back} title="After a conversation">
        <StatusBanner tone="info" label="Loading">
          Getting what you wrote.
        </StatusBanner>
      </PageLayout>
    );
  }
  if (found.kind === "missing" || found.kind === "deleted") {
    return (
      <PageLayout back={back} title="After a conversation">
        <StatusBanner
          tone={deleted ? "success" : "info"}
          label={deleted ? "Deleted" : "Not here"}
        >
          {deleted
            ? "It has been removed from this device."
            : "This isn't on this device. It may have been deleted."}
        </StatusBanner>
      </PageLayout>
    );
  }
  const record = found.kind === "here" ? found.record : undefined;
  return (
    <PageLayout
      back={back}
      title="After a conversation"
      lead={
        record === undefined
          ? AFTER_LEAD
          : `Written on ${formatEntryDate(record.entryDate)}. ${AFTER_LEAD}`
      }
    >
      <AfterForm
        // A different reflection starts with its own words in the boxes.
        key={record?.id ?? NEW_AFTER}
        record={record}
        onDeleted={() => {
          setFound({ kind: "deleted" });
        }}
      />
    </PageLayout>
  );
}
