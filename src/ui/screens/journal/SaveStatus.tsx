import type { JSX } from "preact";
import { useRef } from "preact/hooks";

import type { SaveState } from "../../../domain/journal/drafts";
import { describeStorageError } from "../../storage-messages";

/**
 * Where something that is saved as it is typed stands, in words. Only a
 * settled state is announced to a screen reader: "Saving" comes and goes
 * with every pause in typing, so it is shown but not read out.
 *
 * @param props - The state, and the fixed words for each settled state.
 * @returns The status line.
 */
export function SaveStatus(props: {
  readonly state: SaveState;
  /** What the last failed save threw. */
  readonly error: unknown;
  /** What to say once it is stored. */
  readonly saved: string;
  /** What to say when it could not be stored, if the cause is not known. */
  readonly failed: string;
}): JSX.Element {
  // The last settled message stays in the live region while a save is
  // under way, so it is not announced again after every pause.
  const settled = useRef("");
  if (props.state === "saved") {
    settled.current = props.saved;
  } else if (props.state === "failed") {
    // A known storage failure gets its own words and next step.
    settled.current = describeStorageError(props.error, "save") ?? props.failed;
  } else if (props.state === "idle") {
    settled.current = "";
  }
  const busy = props.state === "waiting" || props.state === "saving";
  return (
    <div class="save-status">
      <p role="status" class={busy ? "visually-hidden" : undefined}>
        {settled.current}
      </p>
      {busy && <p aria-hidden="true">Saving…</p>}
    </div>
  );
}
