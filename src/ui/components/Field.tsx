import type { JSX } from "preact";
import { useId } from "preact/hooks";

interface FieldBaseProps {
  /** Visible label; every field has one. */
  readonly label: string;
  readonly value: string;
  /** Called with the new text on every edit. */
  readonly onInput: (value: string) => void;
  /** Extra guidance shown under the label. */
  readonly hint?: string;
  /** Validation message. When set, the field is marked invalid. */
  readonly error?: string;
  readonly required?: boolean;
  readonly name?: string;
}

/** Props for {@link TextField}. */
export interface TextFieldProps extends FieldBaseProps {
  readonly type?: "text" | "email" | "password";
  /** Browser autofill hint, for example `email` or `current-password`. */
  readonly autocomplete?: string;
}

/** Props for {@link TextArea}. */
export interface TextAreaProps extends FieldBaseProps {
  readonly rows?: number;
}

// Preact types `<input>` as a union keyed on `type`, so each allowed type is
// spelled out as its own literal attribute set.
const INPUT_TYPES = {
  text: { type: "text" },
  email: { type: "email" },
  password: { type: "password" },
} as const;

interface FieldIds {
  readonly control: string;
  readonly hint: string;
  readonly error: string;
}

function describedBy(props: FieldBaseProps, ids: FieldIds): string | undefined {
  const parts = [
    props.hint === undefined ? undefined : ids.hint,
    props.error === undefined ? undefined : ids.error,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function FieldText(props: {
  readonly field: FieldBaseProps;
  readonly ids: FieldIds;
}): JSX.Element {
  const { field, ids } = props;
  return (
    <>
      <label class="field__label" for={ids.control}>
        {field.label}
      </label>
      {field.hint !== undefined && (
        <span class="field__hint" id={ids.hint}>
          {field.hint}
        </span>
      )}
    </>
  );
}

function FieldError(props: {
  readonly field: FieldBaseProps;
  readonly ids: FieldIds;
}): JSX.Element | null {
  if (props.field.error === undefined) {
    return null;
  }
  return (
    <span class="field__error" id={props.ids.error}>
      {props.field.error}
    </span>
  );
}

function useFieldIds(): FieldIds {
  const base = useId();
  return {
    control: `${base}-control`,
    hint: `${base}-hint`,
    error: `${base}-error`,
  };
}

/**
 * A labelled single-line text input. The hint and error are linked with
 * `aria-describedby`, and an error sets `aria-invalid`.
 *
 * @param props - See {@link TextFieldProps}.
 * @returns The field.
 */
export function TextField(props: TextFieldProps): JSX.Element {
  const ids = useFieldIds();
  return (
    <div class="field">
      <FieldText field={props} ids={ids} />
      <input
        {...INPUT_TYPES[props.type ?? "text"]}
        class="field__control"
        id={ids.control}
        name={props.name}
        value={props.value}
        required={props.required === true}
        autocomplete={props.autocomplete}
        aria-invalid={props.error === undefined ? undefined : "true"}
        aria-describedby={describedBy(props, ids)}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
        }}
      />
      <FieldError field={props} ids={ids} />
    </div>
  );
}

/**
 * A labelled multi-line text input for journal-style writing, with the same
 * labelling and error behaviour as {@link TextField}.
 *
 * @param props - See {@link TextAreaProps}.
 * @returns The field.
 */
export function TextArea(props: TextAreaProps): JSX.Element {
  const ids = useFieldIds();
  return (
    <div class="field">
      <FieldText field={props} ids={ids} />
      <textarea
        class="field__control"
        id={ids.control}
        name={props.name}
        rows={props.rows ?? 4}
        value={props.value}
        required={props.required === true}
        aria-invalid={props.error === undefined ? undefined : "true"}
        aria-describedby={describedBy(props, ids)}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
        }}
      />
      <FieldError field={props} ids={ids} />
    </div>
  );
}
