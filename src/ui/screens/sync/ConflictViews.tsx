/**
 * The parts of the "Changed in two places" screen that only show things:
 * one version of an entry in full, and the choices offered for each kind of
 * difference. What a choice does lives in `ConflictReview.tsx`.
 */
import type { JSX } from "preact";

import { PROMPTS, type JournalEntry } from "../../../domain/journal/types";
import type {
  DeletedElsewhere,
  DeletedHere,
  EditedConflict,
} from "../../../sync/conflicts";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { formatEntryDate } from "../journal/shared";

function formatChanged(instant: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}

/** One version of an entry, in full. */
export function Version(props: {
  readonly heading: string;
  readonly entry: JournalEntry;
}): JSX.Element {
  const { entry } = props;
  return (
    <Card heading={props.heading}>
      <p class="version__changed">
        Last changed {formatChanged(entry.updatedAt)}.
        {entry.status === "draft" ? " A draft." : ""}
      </p>
      <dl class="version">
        {PROMPTS.map((prompt) => (
          <div key={prompt.key}>
            <dt>{prompt.label}</dt>
            <dd>
              {entry.responses[prompt.key].trim() === ""
                ? "Not answered."
                : entry.responses[prompt.key]}
            </dd>
          </div>
        ))}
        <div>
          <dt>Feelings noted</dt>
          <dd>
            {entry.feelings === undefined || entry.feelings.length === 0
              ? "None."
              : entry.feelings.join(", ")}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/** Both versions of one entry, and the ways to settle it. */
export function Choice(props: {
  readonly conflict: EditedConflict;
  readonly busy: boolean;
  readonly onKeep: (which: "mine" | "theirs") => void;
  readonly onMerge: () => void;
}): JSX.Element {
  const { conflict } = props;
  const day = formatEntryDate(conflict.mine.entryDate);
  return (
    <section class="conflict" aria-label={`Entry from ${day}`}>
      <h2>Entry from {day}</h2>
      <div class="versions">
        <Version heading="On this device" entry={conflict.mine} />
        <Version heading="On your other device" entry={conflict.theirs} />
      </div>
      <div class="button-row">
        <Button
          disabled={props.busy}
          onClick={() => {
            props.onKeep("mine");
          }}
        >
          Keep this device's version
        </Button>
        <Button
          disabled={props.busy}
          onClick={() => {
            props.onKeep("theirs");
          }}
        >
          Keep the other version
        </Button>
        <Button disabled={props.busy} onClick={props.onMerge}>
          Write one from both
        </Button>
      </div>
    </section>
  );
}

/** An entry changed here and deleted on another device. */
export function DeletedThere(props: {
  readonly conflict: DeletedElsewhere;
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}): JSX.Element {
  const day = formatEntryDate(props.conflict.mine.entryDate);
  return (
    <section class="conflict" aria-label={`Entry from ${day}`}>
      <h2>Entry from {day}</h2>
      <p>
        This entry was deleted on another device after you changed it here. A
        deleted entry does not come back, so your version cannot be saved over
        it. You can save what you wrote as a new entry, or let it go.
      </p>
      <div class="versions">
        <Version heading="On this device" entry={props.conflict.mine} />
      </div>
      <div class="button-row">
        <Button disabled={props.busy} onClick={props.onSave}>
          Save as a new entry
        </Button>
        <Button
          variant="danger"
          disabled={props.busy}
          onClick={props.onDiscard}
        >
          Discard this version
        </Button>
      </div>
    </section>
  );
}

/** An entry deleted here and changed on another device. */
export function DeletedHereChoice(props: {
  readonly conflict: DeletedHere;
  readonly busy: boolean;
  readonly onDelete: () => void;
  readonly onKeep: () => void;
}): JSX.Element {
  const day = formatEntryDate(props.conflict.theirs.entryDate);
  return (
    <section class="conflict" aria-label={`Entry from ${day}`}>
      <h2>Entry from {day}</h2>
      <p>
        You deleted this entry on this device. Before that reached your other
        device, the entry was changed there. Nothing has been deleted from your
        other devices yet.
      </p>
      <div class="versions">
        <Version heading="On your other device" entry={props.conflict.theirs} />
      </div>
      <div class="button-row">
        <Button variant="danger" disabled={props.busy} onClick={props.onDelete}>
          Delete it anyway
        </Button>
        <Button disabled={props.busy} onClick={props.onKeep}>
          Keep the edited version
        </Button>
      </div>
    </section>
  );
}
