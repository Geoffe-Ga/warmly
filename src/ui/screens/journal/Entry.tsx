import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import type { SourceRef } from "../../../ai/contracts";
import {
  PROMPTS,
  type JournalEntry,
  type PromptKey,
} from "../../../domain/journal/types";
import { deleteEntry } from "../../../domain/journal/delete";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PAGE_HEADING_ATTRIBUTE } from "../../components/PageHeading";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { useAction } from "../account/shared";
import { describeOpenFailure } from "../../storage-messages";
import { DependentsWarning } from "./dependents";
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

/** Said above an entry opened from a citation, when the words are marked. */
export const PASSAGE_MARKED =
  "You came here from an answer in Reflect. The words it pointed to are marked below.";

/** Said instead when the entry is no longer what the answer was given. */
export const PASSAGE_STALE =
  "You came here from an answer in Reflect, but this entry has changed since then, so the words it pointed to are not marked.";

/** A range of characters in one answer. */
interface Range {
  readonly start: number;
  readonly end: number;
}

/**
 * Where to mark the cited words in an entry, if they can be trusted.
 *
 * They are marked only if the entry is still the text the answer was
 * given (its content hash matches) and the range lies inside the answer.
 * Otherwise nothing is marked: stale words are never shown as cited.
 *
 * @param entry - The entry as it is now.
 * @param cited - The passage a citation pointed to.
 * @returns The answer and range to mark, or `undefined`.
 */
export function passageIn(
  entry: JournalEntry,
  cited: SourceRef | undefined,
): (Range & { readonly key: PromptKey }) | undefined {
  if (cited === undefined || cited.sourceHash !== entry.contentHash) {
    return undefined;
  }
  const { start, end, responseKey } = cited;
  // A journal entry has only its own three answers. A reference to an
  // answer of another kind of writing marks nothing here.
  const key = PROMPTS.find((prompt) => prompt.key === responseKey)?.key;
  if (key === undefined) {
    return undefined;
  }
  return start >= 0 && start < end && end <= entry.responses[key].length
    ? { key, start, end }
    : undefined;
}

/** One line of an answer, and the part of it that is cited, if any. */
interface MarkedLine {
  readonly text: string;
  /** Where the cited part starts and ends in this line; equal if none. */
  readonly from: number;
  readonly to: number;
}

/**
 * Split an answer into the lines the person wrote, with the part of each
 * that lies inside the cited range. The range is counted over the whole
 * answer, line breaks included.
 */
function markedLines(text: string, mark: Range | undefined): MarkedLine[] {
  let offset = 0;
  return text.split("\n").map((line) => {
    const start = offset;
    offset += line.length + 1;
    const from = Math.max(0, (mark?.start ?? 0) - start);
    const to = Math.min(line.length, (mark?.end ?? 0) - start);
    return mark === undefined || from >= to
      ? { text: line, from: 0, to: 0 }
      : { text: line, from, to };
  });
}

/** One line of an answer, with its cited part marked. */
function Line(props: {
  readonly line: MarkedLine;
  /** Whether this is the first, and the last, line that shows a mark. */
  readonly first: boolean;
  readonly last: boolean;
}): JSX.Element {
  const { text, from, to } = props.line;
  if (from >= to) {
    return <p>{text}</p>;
  }
  return (
    <p>
      {text.slice(0, from)}
      <mark class="cited-passage">
        {props.first && (
          <span class="visually-hidden">Start of the cited words: </span>
        )}
        {text.slice(from, to)}
        {props.last && (
          <span class="visually-hidden"> End of the cited words.</span>
        )}
      </mark>
      {text.slice(to)}
    </p>
  );
}

function Answer(props: {
  readonly text: string;
  readonly mark?: Range | undefined;
}): JSX.Element {
  if (props.text.trim() === "") {
    return <p>Not answered yet.</p>;
  }
  // One paragraph per line the person wrote, so line breaks are kept.
  const lines = markedLines(props.text, props.mark);
  // The start and the end are said on the lines that really show a mark:
  // a range can begin or end on a line break, which shows nothing.
  const shown = lines.flatMap((line, index) =>
    line.from < line.to ? [index] : [],
  );
  return (
    <>
      {lines.map((line, index) => (
        <Line
          key={index}
          line={line}
          first={index === shown[0]}
          last={index === shown.at(-1)}
        />
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
  const { records, events, passage } = useServices();
  const action = useAction();
  const id = props.params["id"];
  // The passage of a citation that was just followed here, taken once.
  // Taken again only if this screen is given a different entry.
  const cited = useMemo(
    () => (id === undefined ? undefined : passage.take(id)),
    [id, passage],
  );
  const [found, setFound] = useState<Found>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [inConflict, setInConflict] = useState(false);
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
    const check = (): void => {
      // Only a marker: if it cannot be worked out, the entry still shows.
      void records.conflicts("journal-entry").then(
        (conflicts) => {
          if (current) {
            setInConflict(conflicts.some((each) => each.id === id));
          }
        },
        () => undefined,
      );
    };
    const refresh = (): void => {
      load();
      check();
    };
    refresh();
    const unsubscribe = records.subscribe(refresh);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [records, id]);

  const marked =
    found.kind === "entry" ? passageIn(found.entry, cited) : undefined;
  const isMarked = marked !== undefined;
  useEffect(() => {
    // Bring the marked words into view: they may be far down a long entry.
    const mark = isMarked ? document.querySelector(".cited-passage") : null;
    if (mark !== null && typeof mark.scrollIntoView === "function") {
      mark.scrollIntoView({ block: "center" });
    }
  }, [isMarked]);

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
      {inConflict && (
        <StatusBanner tone="warning" label="Changed in two places">
          This {what} was also changed on another device. This is the version
          from this device; both are kept until you choose.{" "}
          <Link href={pathFor("sync-conflicts")}>Review the two versions</Link>
        </StatusBanner>
      )}
      {cited !== undefined && (
        <p role="status" class="hint">
          {marked === undefined ? PASSAGE_STALE : PASSAGE_MARKED}
        </p>
      )}
      {PROMPTS.map((prompt) => (
        <Card key={prompt.key} heading={prompt.label}>
          <Answer
            text={entry.responses[prompt.key]}
            mark={marked?.key === prompt.key ? marked : undefined}
          />
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
        <p>{DELETE_WARNING}</p>
        {entry.status === "complete" && (
          <DependentsWarning entryId={entry.id} doing="delete" />
        )}
      </ConfirmDialog>
      {back}
    </PageLayout>
  );
}
