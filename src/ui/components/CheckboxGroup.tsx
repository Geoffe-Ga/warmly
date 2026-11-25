import type { JSX } from "preact";
import { useId } from "preact/hooks";

/** Props for {@link CheckboxGroup}. */
export interface CheckboxGroupProps<T extends string> {
  /** The question the group asks; shown as the group's legend. */
  readonly legend: string;
  /** Extra guidance shown under the legend. */
  readonly hint?: string;
  /** Every choice, in the order shown. Each is its own visible label. */
  readonly options: readonly T[];
  /** The choices that are ticked. */
  readonly selected: readonly T[];
  /** Called with the new selection each time a box is ticked or cleared. */
  readonly onChange: (selected: T[]) => void;
  /** Shared `name` of the checkboxes. */
  readonly name?: string;
}

/**
 * A group of checkboxes for choosing any number of options, or none. It is
 * a `fieldset` with a `legend`, so a screen reader announces the question
 * with each box, and every box is a native checkbox that works with Space.
 *
 * @param props - See {@link CheckboxGroupProps}.
 * @returns The group.
 */
export function CheckboxGroup<T extends string>(
  props: CheckboxGroupProps<T>,
): JSX.Element {
  const hintId = `${useId()}-hint`;
  const toggle = (option: T, ticked: boolean): void => {
    props.onChange(
      props.options.filter((each) =>
        each === option ? ticked : props.selected.includes(each),
      ),
    );
  };

  return (
    <fieldset
      class="choices"
      aria-describedby={props.hint === undefined ? undefined : hintId}
    >
      <legend class="field__label">{props.legend}</legend>
      {props.hint !== undefined && (
        <span class="field__hint" id={hintId}>
          {props.hint}
        </span>
      )}
      <ul class="choices__list">
        {props.options.map((option) => (
          <li key={option}>
            <label class="choices__option">
              <input
                type="checkbox"
                name={props.name}
                value={option}
                checked={props.selected.includes(option)}
                onChange={(event) => {
                  toggle(option, event.currentTarget.checked);
                }}
              />
              <span>{option}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
