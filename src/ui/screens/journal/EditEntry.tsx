import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { canComplete, unanswered } from "../../../domain/journal/validation";
import { StaleRecordError } from "../../../storage/record-store";
import { Button } from "../../components/Button";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ActionForm, useAction } from "../../components/ActionForm";
import { EntryFields, OutOfDate } from "./EntryFields";
import { DependentsWarning } from "./dependents";
import { SaveStatus } from "./SaveStatus";
import { CANNOT_OPEN, formatEntryDate } from "./shared";
import { useEditForm } from "./useEditForm";

/** Said once the unsaved changes are kept. */
export const CHANGES_KEPT = "Unsaved changes are kept on this device";
/** Said when the unsaved changes could not be kept. */
export const CHANGES_NOT_KEPT =
  "Your unsaved changes couldn't be kept on this device. They are still on this page: save them before you leave it.";
/** Said when the form opens with unsaved changes from an earlier visit. */
export const CHANGES_BROUGHT_BACK =
  "These are changes you typed here earlier and did not save. The entry itself has not been changed by them. Save them, or start again from the saved entry.";
/** Added when the entry is no longer the one those changes were made to. */
export const ENTRY_CHANGED_SINCE =
  "The entry has been changed since you typed them. Saving will replace what it says now.";

/** What is said when there is no entry to edit. */
const NOTICES = {
  loading: { tone: "info", label: "Loading", text: "Getting your entry." },
  missing: {
    tone: "info",
    label: "Not here",
    text: "There is no finished entry here to edit. It may have been deleted.",
  },
  failed: {
    tone: "error",
    label: "Couldn't open your journal",
    text: CANNOT_OPEN,
  },
} as const;

/**
 * Edit a completed journal entry in place (PRD JR-006; AC-06).
 *
 * Saving overwrites the entry: its day and creation time stay, and the old
 * text is not kept anywhere. The same rule as for a new entry applies:
 * every answer needs some text. Nothing here calls AI or the network.
 *
 * What is typed is not saved as a draft of the entry, because that would
 * change the entry before the person chose to. It is kept apart from the
 * entry until it is saved or cancelled, and offered again if the app locked
 * or the page was closed first (ADR-0015).
 *
 * @param props - The route's parameters; `id` names the entry.
 * @returns The edit screen.
 */
export function EditEntry(props: {
  readonly params: RouteParams;
}): JSX.Element {
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const id = props.params["id"] ?? "";
  const form = useEditForm(id);
  const { found, content } = form;
  const [tried, setTried] = useState(false);
  const [outOfDate, setOutOfDate] = useState(false);

  const back = (
    <p>
      <Link href={pathFor("journal")}>Back to your journal</Link>
    </p>
  );

  if (found.kind !== "entry") {
    const notice = NOTICES[found.kind];
    return (
      <PageLayout title="Edit journal entry">
        <StatusBanner tone={notice.tone} label={notice.label}>
          {found.kind === "failed" ? found.message : notice.text}
        </StatusBanner>
        {back}
      </PageLayout>
    );
  }

  const entryPath = pathFor("journal-entry", { id });
  return (
    <PageLayout
      title="Edit journal entry"
      lead={`Your entry from ${formatEntryDate(found.entry.entryDate)}.`}
    >
      {outOfDate && (
        <OutOfDate
          what="entry"
          disabled={action.busy}
          onLoad={() => {
            action.run(async () => {
              await form.loadLatest();
              setOutOfDate(false);
              setTried(false);
            });
          }}
        />
      )}
      {form.recovered !== undefined && (
        <StatusBanner tone="info" label="Unsaved changes brought back">
          {CHANGES_BROUGHT_BACK}
          {form.recovered.entryChangedSince && ` ${ENTRY_CHANGED_SINCE}`}
          <div class="button-row">
            <Button
              disabled={action.busy}
              onClick={() => {
                action.run(async () => {
                  await form.startAgain();
                  setTried(false);
                });
              }}
            >
              Start again from the saved entry
            </Button>
          </div>
        </StatusBanner>
      )}
      <DependentsWarning entryId={id} doing="edit" />
      <ActionForm
        action={action}
        validate={() => {
          setTried(true);
          return canComplete(content.responses);
        }}
        onValid={async () => {
          try {
            await form.save();
          } catch (error) {
            if (error instanceof StaleRecordError) {
              setOutOfDate(true);
              return;
            }
            throw error;
          }
          navigate(entryPath);
        }}
      >
        <p>
          Saving replaces what this entry said. The earlier wording is not kept,
          and there is no undo. The entry keeps its date.
        </p>
        <p>
          Until you save, the entry stays as it was. What you type is kept on
          this device, apart from the entry, so that locking Warmly or closing
          this page does not lose it. Cancelling removes it.
        </p>
        <EntryFields
          content={content}
          missing={tried ? unanswered(content.responses) : []}
          onChange={form.change}
        />
        <SaveStatus
          state={form.keepState}
          error={form.keepError}
          saved={CHANGES_KEPT}
          failed={CHANGES_NOT_KEPT}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Save changes
          </Button>
          <Button
            disabled={action.busy}
            onClick={() => {
              action.run(async () => {
                await form.abandon();
                navigate(entryPath);
              });
            }}
          >
            Cancel and go back to the entry
          </Button>
        </div>
      </ActionForm>
    </PageLayout>
  );
}
