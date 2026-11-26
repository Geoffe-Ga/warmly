import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { Link } from "../../app/navigation";
import { pathFor } from "../../app/routes";
import type { Provenance } from "../../domain/cards/provenance";
import type { CardSegment } from "../../domain/cards/types";
import { formatEntryDate } from "../screens/journal/shared";
import { Button } from "./Button";

/** Said of a part that is the AI's reading of what the person wrote. */
export const INFERRED =
  "This is inferred from your writing. You did not write it: the AI read it into what you wrote, and it may be wrong. Keep it only if it is true for you.";

/** Said of a part the AI added by itself. */
export const SUGGESTED =
  "This is a suggested addition. It does not come from your journal. Keep it only if you want to say it.";

/** Said when the words a part rested on can no longer be shown. */
export const UNRESOLVED =
  "The words this rested on can't be shown. The journal entry is not on this device, or it has changed since the card was drafted.";

/** Said while the journal is still being read. */
export const JOURNAL_LOADING = "Getting your journal to find the words.";

/** Said when the journal could not be opened at all. */
export const JOURNAL_NOT_OPEN =
  "Your journal couldn't be opened just now, so the words this rests on can't be shown. Nothing has been removed. Reload the page to try again.";

/** Said of a part with no annotation at all. */
export const OWN_WORDS = "These are your own words.";

/**
 * Said with every explanation (PRD CC-005): what an I-statement is, and
 * what it is not.
 */
export const I_STATEMENT_CAVEAT =
  'A sentence that starts with "I" says what you experienced: what you noticed, felt or need. That is yours to say. It does not make a claim about what happened true, or beyond question.';

/** Said beside the button that will ask for other wordings. */
export const MORE_OPTIONS_LATER =
  "Asking AI for other ways to word this part is not available yet.";

/** Props for {@link SegmentDetail}. */
export interface SegmentDetailProps {
  /** The panel's ID, which its button names in `aria-controls`. */
  readonly id: string;
  readonly segment: CardSegment;
  /** What the part rests on, worked out from the journal as it is now. */
  readonly provenance: Provenance;
  readonly onClose: () => void;
}

function Source(props: { readonly provenance: Provenance }): JSX.Element {
  const { provenance } = props;
  switch (provenance.kind) {
    case "inferred":
      return <p>{INFERRED}</p>;
    case "suggested":
      return <p>{SUGGESTED}</p>;
    case "unresolved":
      return <p>{UNRESOLVED}</p>;
    case "loading":
      return <p>{JOURNAL_LOADING}</p>;
    case "unknown":
      return <p>{JOURNAL_NOT_OPEN}</p>;
    case "own":
      return <p>{OWN_WORDS}</p>;
    case "quoted":
      return (
        <ul class="segment-detail__sources">
          {provenance.excerpts.map((excerpt, index) => (
            <li key={index}>
              <q data-testid="source-excerpt">{excerpt.text}</q>
              <span class="hint">
                {" "}
                From{" "}
                <Link href={pathFor("journal-entry", { id: excerpt.entryId })}>
                  your entry from {formatEntryDate(excerpt.entryDate)}
                </Link>
                , under &ldquo;{excerpt.prompt}&rdquo;
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * What learning mode shows about one part of a card (PRD CC-004, CC-005;
 * AC-11, AC-26):
 *
 * - what it rests on: the person's own words, read from the journal as it
 *   is now, or a plain statement that it is inferred or suggested;
 * - why the wording may help, with what an I-statement is and is not;
 * - the button that will ask AI for other wordings. It does nothing yet,
 *   and says so.
 *
 * Opening it calls no AI and sends nothing. The heading takes focus when
 * the panel opens, Escape closes it, and the screen puts focus back on
 * the part it belongs to.
 *
 * @param props - See {@link SegmentDetailProps}.
 * @returns The panel.
 */
export function SegmentDetail(props: SegmentDetailProps): JSX.Element {
  const { segment, provenance, onClose } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = `${props.id}-heading`;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section
      id={props.id}
      class="segment-detail"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h3 id={headingId} tabIndex={-1} ref={heading}>
        About this part
      </h3>
      <h4>Where it comes from</h4>
      <Source provenance={provenance} />
      {segment.teachingExplanation !== undefined &&
        segment.teachingExplanation.trim() !== "" && (
          <>
            <h4>Why this wording may help</h4>
            <p>{segment.teachingExplanation}</p>
            <p class="hint">{I_STATEMENT_CAVEAT}</p>
          </>
        )}
      <div class="button-row">
        <Button disabled>Generate more options</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
      <p class="hint">{MORE_OPTIONS_LATER}</p>
    </section>
  );
}
