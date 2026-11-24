import type { ComponentChildren, JSX } from "preact";

/** Props for {@link Card}. */
export interface CardProps {
  readonly children: ComponentChildren;
  /** Optional heading; when present the card is a labelled region. */
  readonly heading?: string;
}

/**
 * A bordered surface that groups related content.
 *
 * @param props - See {@link CardProps}.
 * @returns A `<section>` with an optional `<h2>`.
 */
export function Card(props: CardProps): JSX.Element {
  return (
    <section class="card">
      {props.heading !== undefined && <h2>{props.heading}</h2>}
      {props.children}
    </section>
  );
}
