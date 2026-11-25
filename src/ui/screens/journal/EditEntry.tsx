import type { JSX } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { BLANK, type EntryContent } from "../../../domain/journal/drafts";
import { editEntry } from "../../../domain/journal/edit";
import type { JournalEntry } from "../../../domain/journal/types";
import { canComplete, unanswered } from "../../../domain/journal/validation";
import { StaleRecordError } from "../../../storage/record-store";
import { Button } from "../../components/Button";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { AccountForm, useAction } from "../account/shared";
import { EntryFields, OutOfDate } from "./EntryFields";
import { CANNOT_OPEN, formatEntryDate } from "./shared";

/** What the screen has found out about the entry to edit. */
type Found =
  | { readonly kind: "loading" | "missing" | "failed" }
  | { readonly kind: "entry"; readonly entry: JournalEntry };

function contentOf(entry: JournalEntry): EntryContent {
  return { responses: entry.responses, feelings: entry.feelings ?? [] };
}

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
 * What is typed is held only on this screen until it is saved. It is not
 * saved as a draft, because that would change the entry before the person
 * chose to.
 *
 * @param props - The route's parameters; `id` names the entry.
 * @returns The edit screen.
 */
export function EditEntry(props: {
  readonly params: RouteParams;
}): JSX.Element {
  const { records, events } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const id = props.params["id"] ?? "";
  const [found, setFound] = useState<Found>({ kind: "loading" });
  const [content, setContent] = useState<EntryContent>(BLANK);
  const [tried, setTried] = useState(false);
  const [outOfDate, setOutOfDate] = useState(false);

  // Uses only state setters, which never change, so it is safe to call from
  // the effect below although it is made again on every render.
  const show = (entry: JournalEntry | undefined): void => {
    if (entry?.status === "complete") {
      setFound({ kind: "entry", entry });
      setContent(contentOf(entry));
    } else {
      setFound({ kind: "missing" });
    }
  };

  useEffect(() => {
    let current = true;
    void records.get("journal-entry", id).then(
      (entry) => {
        if (current) {
          show(entry);
        }
      },
      () => {
        if (current) {
          setFound({ kind: "failed" });
        }
      },
    );
    return () => {
      current = false;
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
      <PageLayout title="Edit journal entry">
        <StatusBanner tone={notice.tone} label={notice.label}>
          {notice.text}
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
              show(await records.reload("journal-entry", id));
              setOutOfDate(false);
              setTried(false);
            });
          }}
        />
      )}
      <AccountForm
        action={action}
        validate={() => {
          setTried(true);
          return canComplete(content.responses);
        }}
        onValid={async () => {
          try {
            await editEntry({ records, events }, id, content);
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
        <EntryFields
          content={content}
          missing={tried ? unanswered(content.responses) : []}
          onChange={setContent}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Save changes
          </Button>
        </div>
      </AccountForm>
      <p>
        <Link href={entryPath}>Cancel and go back to the entry</Link>
      </p>
    </PageLayout>
  );
}
