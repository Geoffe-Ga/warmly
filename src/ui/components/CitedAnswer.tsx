import type { JSX } from "preact";

import type { ReflectionAnswer, SourceRef } from "../../ai/contracts";
import { Link } from "../../app/navigation";
import { pathFor } from "../../app/routes";
import type { JournalEntry } from "../../domain/journal/types";
import { formatEntryDate } from "../screens/journal/shared";

/** Said for a source whose entry has been changed since the answer. */
export const SOURCE_CHANGED =
  "This entry has been changed since this answer was written, so the words it pointed to are not shown.";

/** Said for a source whose entry is not on this device any more. */
export const SOURCE_GONE = "This entry is no longer on this device.";

/** One place in the journal an answer points to, with its number. */
interface Source {
  readonly number: number;
  readonly ref: SourceRef;
}

const MARKER = /\[(c[1-9]\d?)\]/;

function sameRef(a: SourceRef, b: SourceRef): boolean {
  return (
    a.entryId === b.entryId &&
    a.responseKey === b.responseKey &&
    a.start === b.start &&
    a.end === b.end
  );
}

/**
 * Number the places an answer points to, in the order its claims cite
 * them. The same place cited twice keeps one number.
 */
function numberSources(answer: ReflectionAnswer): {
  readonly sources: readonly Source[];
  readonly byClaim: ReadonlyMap<string, readonly Source[]>;
} {
  const sources: Source[] = [];
  const byClaim = new Map<string, Source[]>();
  for (const citation of answer.citations) {
    const cited = citation.evidence.map((ref) => {
      const known = sources.find((source) => sameRef(source.ref, ref));
      if (known !== undefined) {
        return known;
      }
      const added = { number: sources.length + 1, ref };
      sources.push(added);
      return added;
    });
    byClaim.set(citation.claimId, cited);
  }
  return { sources, byClaim };
}

function entryFor(
  entries: readonly JournalEntry[],
  ref: SourceRef,
): JournalEntry | undefined {
  return entries.find((entry) => entry.id === ref.entryId);
}

function sourceLabel(number: number, entry: JournalEntry | undefined): string {
  return entry === undefined
    ? `Source ${String(number)}`
    : `Source ${String(number)}: your entry from ${formatEntryDate(entry.entryDate)}`;
}

/** The numbered links that stand where a claim's mark was. */
function Marks(props: {
  readonly cited: readonly Source[];
  readonly entries: readonly JournalEntry[];
}): JSX.Element {
  return (
    <>
      {props.cited.map((source) => {
        const entry = entryFor(props.entries, source.ref);
        const shown = `[${String(source.number)}]`;
        return entry === undefined ? (
          <span key={source.number} class="citation">
            {shown}
          </span>
        ) : (
          <Link
            key={source.number}
            href={pathFor("journal-entry", { id: entry.id })}
            class="citation"
            label={sourceLabel(source.number, entry)}
          >
            {shown}
          </Link>
        );
      })}
    </>
  );
}

/** One paragraph of the answer, with claim marks turned into links. */
function Paragraph(props: {
  readonly text: string;
  readonly byClaim: ReadonlyMap<string, readonly Source[]>;
  readonly entries: readonly JournalEntry[];
}): JSX.Element {
  // Splitting on a pattern with one group gives text and claim IDs in turn.
  const parts = props.text.split(MARKER);
  return (
    <p>
      {parts.map((part, index) =>
        index % 2 === 0 ? (
          part
        ) : (
          <Marks
            key={index}
            cited={props.byClaim.get(part) ?? []}
            entries={props.entries}
          />
        ),
      )}
    </p>
  );
}

/** What a source says now: the words it pointed to, or why they are not shown. */
function Excerpt(props: {
  readonly source: Source;
  readonly entry: JournalEntry | undefined;
}): JSX.Element {
  const { ref } = props.source;
  const { entry } = props;
  if (entry === undefined) {
    return <span>{SOURCE_GONE}</span>;
  }
  // The words are read from the entry as it is now, and only if it is the
  // entry that was sent: an answer never shows words from changed text.
  if (entry.contentHash !== ref.sourceHash) {
    return <span>{SOURCE_CHANGED}</span>;
  }
  return <q>{entry.responses[ref.responseKey].slice(ref.start, ref.end)}</q>;
}

/**
 * A checked AI answer as ordinary prose, with numbered links to the
 * person's own journal entries and, underneath, the words each one points
 * to (PRD RF-005, RF-008; AC-07, AC-26).
 *
 * The answer's text is shown as text. It is never treated as HTML or
 * Markdown, so nothing in it can become a link, an image or a script; the
 * only links are the ones made here, and they lead only to the person's
 * own entries inside the app.
 *
 * @param props - The checked answer, and the journal to read the cited
 *   words from.
 * @returns The prose and its sources.
 */
/**
 * What is said above an answer that rests on part of the journal (PRD
 * AC-09). It comes from what the app sent, never from what the model
 * wrote, so an answer cannot pass for one about the whole journal.
 *
 * @param answer - The checked answer.
 * @returns The sentence, or `undefined` when every entry was sent.
 */
export function coverageNote(answer: ReflectionAnswer): string | undefined {
  const { includedEntryIds, omittedEntryCount, truncated } = answer.coverage;
  if (!truncated && omittedEntryCount === 0) {
    return undefined;
  }
  const sent = includedEntryIds.length.toLocaleString("en-US");
  const all = (includedEntryIds.length + omittedEntryCount).toLocaleString(
    "en-US",
  );
  return `This answer is about ${sent} of the ${all} journal entries you had when you asked. The others did not fit in one request, so it does not speak for your whole journal.`;
}

export function CitedAnswer(props: {
  readonly answer: ReflectionAnswer;
  readonly entries: readonly JournalEntry[];
}): JSX.Element {
  const { answer, entries } = props;
  const { sources, byClaim } = numberSources(answer);
  const paragraphs = answer.markdown
    .split(/\n{2,}/)
    .filter((text) => text.trim() !== "");

  const partial = coverageNote(answer);

  return (
    <div class="cited-answer">
      {partial !== undefined && <p class="hint">{partial}</p>}
      {paragraphs.map((text, index) => (
        <Paragraph
          key={index}
          text={text}
          byClaim={byClaim}
          entries={entries}
        />
      ))}
      {sources.length > 0 && (
        <section aria-label="Where this comes from in your journal">
          <h3>From your journal</h3>
          <ol class="cited-answer__sources">
            {sources.map((source) => {
              const entry = entryFor(entries, source.ref);
              return (
                <li key={source.number}>
                  {entry !== undefined && (
                    <>
                      <Link href={pathFor("journal-entry", { id: entry.id })}>
                        Your entry from {formatEntryDate(entry.entryDate)}
                      </Link>
                      {": "}
                    </>
                  )}
                  <Excerpt source={source} entry={entry} />
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
