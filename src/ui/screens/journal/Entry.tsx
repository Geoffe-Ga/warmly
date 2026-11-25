import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { PROMPTS, type JournalEntry } from "../../../domain/journal/types";
import { deleteEntry } from "../../../domain/journal/delete";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { useAction } from "../account/shared";
import { describeOpenFailure } from "../../storage-messages";
import { CANNOT_OPEN, formatEntryDate } from "./shared";

/** What the screen has found out about the entry. */
type Found =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "deleted" }
  | { readonly kind: "entry"; readonly entry: JournalEntry };

/**
 * What the screen shows once the store has answered. Once the entry has
 * been deleted here the screen keeps saying so, whatever the store reports
 * afterwards.
 */
function afterLoading(was: Found, entry: JournalEntry | undefined): Found {
  if (was.kind === "deleted") {
    return was;
  }
  return entry === undefined ? { kind: "missing" } : { kind: "entry", entry };
}

/** What is said when there is no entry to show. */
const NOTICES = {
  loading: { tone: "info", label: "Loading", text: "Getting your entry." },
  missing: {
    tone: "info",
    label: "Not here",
    text: "This entry isn't on this device. It may have been deleted, or this version of Warmly may not be able to read it.",
  },
  failed: {
    tone: "error",
    label: "Couldn't open your journal",
    text: CANNOT_OPEN,
  },
  deleted: {
    tone: "success",
    label: "Deleted",
    text: "It has been removed from this device.",
  },
} as const;

/**
 * What deleting does, said before the person confirms (JR-007, OPS-003).
 *
 * This text must be true. It describes sync and backups: check it against
 * what they really do when sync ships (#32) and when backup retention is
 * verified (#65), and change it and its tests if they differ.
 */
export const DELETE_WARNING =
  "This deletes it from this device now, and from your other devices the next time they sync. There is no trash and no undo. Encrypted copies held in backups cannot be read by anyone but you, and are removed as those backups expire, within 30 days.";

function Answer(props: { readonly text: string }): JSX.Element {
  if (props.text.trim() === "") {
    return <p>Not answered yet.</p>;
  }
  // One paragraph per line the person wrote, so line breaks are kept.
  return (
    <>
      {props.text.split("\n").map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </>
  );
}

/**
 * One journal entry: its date, the three answers under their questions,
 * and the way to edit it (PRD JR-001, JR-005, JR-006). Opening an entry
 * never calls AI. The entry can be deleted for good after a confirmation
 * that says what deleting does and does not remove (JR-007, OPS-003).
 *
 * @param props - The route's parameters; `id` names the entry.
 * @returns The entry screen.
 */
export function Entry(props: { readonly params: RouteParams }): JSX.Element {
  const { records, events } = useServices();
  const action = useAction();
  const id = props.params["id"];
  const [found, setFound] = useState<Found>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const deleted = found.kind === "deleted";

  useEffect(() => {
    // The button that had focus has gone with the entry, so focus moves to
    // the heading, which now says what happened.
    if (deleted) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [deleted]);

  useEffect(() => {
    let current = true;
    const load = (): void => {
      void (
        id === undefined
          ? Promise.resolve(undefined)
          : records.get("journal-entry", id)
      ).then(
        (entry) => {
          if (current) {
            setFound((was) => afterLoading(was, entry));
          }
        },
        (error: unknown) => {
          if (current) {
            setFound((was) =>
              was.kind === "deleted"
                ? was
                : { kind: "failed", message: describeOpenFailure(error) },
            );
          }
        },
      );
    };
    load();
    const unsubscribe = records.subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [records, id]);

  const back = (
    <p>
      <Link href={pathFor("journal")}>Back to your journal</Link>
    </p>
  );

  if (found.kind !== "entry") {
    const notice = NOTICES[found.kind];
    return (
      <PageLayout title={deleted ? "Entry deleted" : "Journal entry"}>
        <StatusBanner tone={notice.tone} label={notice.label}>
          {found.kind === "failed" ? found.message : notice.text}
        </StatusBanner>
        {back}
      </PageLayout>
    );
  }

  const { entry } = found;
  const what = entry.status === "draft" ? "draft" : "entry";
  return (
    <PageLayout
      title={formatEntryDate(entry.entryDate)}
      lead={
        entry.status === "draft"
          ? "A draft: not every question is answered yet."
          : "A journal entry."
      }
    >
      {PROMPTS.map((prompt) => (
        <Card key={prompt.key} heading={prompt.label}>
          <Answer text={entry.responses[prompt.key]} />
        </Card>
      ))}
      {entry.feelings !== undefined && entry.feelings.length > 0 && (
        <Card heading="Feelings you noted">
          <p>{entry.feelings.join(", ")}</p>
        </Card>
      )}
      <p>
        {entry.status === "draft" ? (
          <Link href={pathFor("journal-new")}>Carry on writing</Link>
        ) : (
          <Link href={pathFor("journal-edit", { id: entry.id })}>
            Edit this entry
          </Link>
        )}
      </p>
      {action.error !== undefined && (
        <StatusBanner tone="error" label="Couldn't delete">
          {action.error}
        </StatusBanner>
      )}
      <div class="button-row">
        <Button
          variant="danger"
          disabled={action.busy}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Delete this {what}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Delete this ${what} for good?`}
        confirmLabel={`Delete ${what}`}
        cancelLabel={`Keep this ${what}`}
        destructive
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          action.run(async () => {
            await deleteEntry({ records, events }, entry.id);
            setFound({ kind: "deleted" });
          });
        }}
      >
        {DELETE_WARNING}
      </ConfirmDialog>
      {back}
    </PageLayout>
  );
}
