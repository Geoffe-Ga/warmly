import type { ComponentChildren, JSX } from "preact";

/**
 * Where a screen's delete button sits: apart from the other buttons, at
 * the end, under its own short heading, so it is not pressed by a slip
 * from Save. The button still asks before anything is deleted.
 *
 * @param props - The button and anything said about it; `nested` when the
 *   section sits inside a card, whose heading is one level up.
 * @returns A section headed "Delete".
 */
export function DangerZone(props: {
  readonly children: ComponentChildren;
  readonly nested?: boolean;
}): JSX.Element {
  return (
    <section class="danger-zone">
      {props.nested === true ? <h3>Delete</h3> : <h2>Delete</h2>}
      {props.children}
    </section>
  );
}
