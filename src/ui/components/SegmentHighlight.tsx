import type { JSX, Ref } from "preact";

import type { SegmentCategory } from "../../ai/contracts";
import type { CardSegment } from "../../domain/cards/types";

/** How each kind of part is named on screen. */
export const CATEGORY_LABELS: Readonly<Record<SegmentCategory, string>> = {
  observation: "Observation",
  feeling: "Feeling",
  need: "Need",
  request: "Request",
  appreciation: "Appreciation",
  curiosity: "Curiosity",
  other: "Other",
};

/** Props for {@link SegmentHighlight}. */
export interface SegmentHighlightProps {
  readonly segment: CardSegment;
  /** Whether this part's detail is showing. */
  readonly open: boolean;
  /** The ID of the detail panel this button shows and hides. */
  readonly controls: string;
  readonly onToggle: () => void;
  /** Given the button, so focus can be returned to it. */
  readonly buttonRef: Ref<HTMLButtonElement>;
}

/**
 * One part of a card in learning mode (PRD CC-005; AC-11, AC-23).
 *
 * It is a real button: it takes focus, works with Enter and Space as well
 * as a tap, and says whether its detail is open. What kind of part it is
 * is written out above its words, so it is never told by colour alone.
 * Its name is its visible text and nothing else: "Need I need more
 * notice."
 *
 * @param props - See {@link SegmentHighlightProps}.
 * @returns The button.
 */
export function SegmentHighlight(props: SegmentHighlightProps): JSX.Element {
  const { segment } = props;
  return (
    <button
      type="button"
      class="segment"
      ref={props.buttonRef}
      aria-expanded={props.open ? "true" : "false"}
      aria-controls={props.open ? props.controls : undefined}
      onClick={props.onToggle}
    >
      <span class="segment__category">{CATEGORY_LABELS[segment.category]}</span>
      {/* A space between the two, so the button's name reads as separate
          words and matches what is seen, which voice control relies on. */}{" "}
      <span class="segment__text">{segment.text}</span>
    </button>
  );
}
