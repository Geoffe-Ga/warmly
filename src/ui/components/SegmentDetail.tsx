import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { SegmentAlternatives } from "../../ai/contracts";
import type { SegmentAlternativesRequest } from "../../ai/provider";
import { AiRequestController } from "../../ai/request-controller";
import { useServices } from "../../app/services";

import { Link } from "../../app/navigation";
import { pathFor } from "../../app/routes";
import type { Provenance } from "../../domain/cards/provenance";
import type { CardSegment } from "../../domain/cards/types";
import { formatEntryDate } from "../screens/journal/shared";
import { AiRequestStatus, useAiRequest } from "./AiRequestStatus";
import { Button } from "./Button";
import { StatusBanner } from "./StatusBanner";

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

/** Said beside the button that asks for other wordings. */
export const MORE_OPTIONS_HINT =
  "Asks AI for other ways to say this part. You are shown what would be sent, and nothing is sent unless you agree.";

/** Said above the wordings that came back. */
export const OPTIONS_ARE_SUGGESTIONS =
  "These are AI suggestions. Nothing has checked them against your journal. Use one only if it says what you mean; they are not saved unless you pick one.";

/** Said once a wording has been put in place. */
export const WORDING_USED =
  "This part now uses the wording you picked. It is marked as a suggestion.";

/** Said when a picked wording could not be stored. */
export const WORDING_NOT_SAVED =
  "Warmly couldn't save that wording, so the card is as it was. The suggestions are still here. Try again in a moment.";

/** Props for {@link SegmentDetail}. */
export interface SegmentDetailProps {
  /** The panel's ID, which its button names in `aria-controls`. */
  readonly id: string;
  readonly segment: CardSegment;
  /** What the part rests on, worked out from the journal as it is now. */
  readonly provenance: Provenance;
  readonly onClose: () => void;
  /**
   * Builds the request for other wordings of this part. Called only when
   * the person presses the button, never when the panel opens.
   */
  readonly request: () => SegmentAlternativesRequest;
  /**
   * Puts a wording the person picked in place of this part.
   *
   * @returns Whether it was stored.
   */
  readonly onChoose: (text: string) => Promise<boolean>;
}

/**
 * The button that asks for other wordings, the request's dialog and
 * status, and the wordings that come back.
 *
 * Nothing is asked until the button is pressed, and each press is its own
 * request with its own dialog. The wordings are kept only here, on
 * screen: closing the panel, dismissing them or leaving the page forgets
 * them, and none is stored unless the person picks it.
 */
function MoreOptions(props: {
  readonly request: () => SegmentAlternativesRequest;
  readonly onChoose: (text: string) => Promise<boolean>;
  readonly onClose: () => void;
}): JSX.Element {
  const { ai } = useServices();
  const controller = useMemo(
    () =>
      new AiRequestController<SegmentAlternativesRequest, SegmentAlternatives>(
        (request, consent, signal) =>
          ai.generateSegmentAlternatives(request, consent, signal),
      ),
    [ai],
  );
  const state = useAiRequest(controller);
  const [options, setOptions] = useState<readonly string[]>();
  const [used, setUsed] = useState(false);
  const [problem, setProblem] = useState(false);
  const [saving, setSaving] = useState(false);

  // Closing the panel, leaving the screen or locking stops a request and
  // forgets it, with any wordings that had come back.
  useEffect(
    () => () => {
      controller.reset();
    },
    [controller],
  );

  useEffect(() => {
    if (state.phase === "done") {
      setOptions(state.result.alternatives);
      controller.reset();
    }
  }, [state, controller]);

  const busy =
    saving || state.phase === "running" || state.phase === "awaiting-consent";

  return (
    <>
      <div class="button-row">
        <Button
          disabled={busy}
          onClick={() => {
            setUsed(false);
            setProblem(false);
            setOptions(undefined);
            // Nothing is sent here: this opens the dialog that asks first.
            controller.ask(props.request());
          }}
        >
          Generate more options
        </Button>
        <Button onClick={props.onClose}>Close</Button>
      </div>
      <p class="hint">{MORE_OPTIONS_HINT}</p>
      <AiRequestStatus controller={controller} />
      {options !== undefined && (
        <section aria-label="Other ways to say this part">
          <h4>Other ways to say this part</h4>
          <p class="hint">{OPTIONS_ARE_SUGGESTIONS}</p>
          <ul class="segment-detail__options">
            {options.map((text, index) => (
              <li key={index}>
                <p class="card-reading">{text}</p>
                <Button
                  disabled={busy}
                  ariaLabel={`Use this wording: ${text}`}
                  onClick={() => {
                    setProblem(false);
                    setSaving(true);
                    void props.onChoose(text).then((stored) => {
                      setSaving(false);
                      if (stored) {
                        setOptions(undefined);
                        setUsed(true);
                      } else {
                        setProblem(true);
                      }
                    });
                  }}
                >
                  Use this wording
                </Button>
              </li>
            ))}
          </ul>
          {problem && (
            <StatusBanner tone="error" label="Not saved">
              {WORDING_NOT_SAVED}
            </StatusBanner>
          )}
          <div class="button-row">
            <Button
              disabled={busy}
              onClick={() => {
                setOptions(undefined);
              }}
            >
              Dismiss these suggestions
            </Button>
          </div>
        </section>
      )}
      <p role="status" class="hint">
        {used ? WORDING_USED : ""}
      </p>
    </>
  );
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
 * - a button that asks AI for other wordings of this part. Each press is
 *   a request of its own, with its own dialog saying what would be sent.
 *   What comes back is shown as suggestions and is not stored unless the
 *   person picks one.
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
      <MoreOptions
        request={props.request}
        onChoose={props.onChoose}
        onClose={onClose}
      />
    </section>
  );
}
