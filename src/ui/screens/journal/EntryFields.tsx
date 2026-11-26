import type { JSX } from "preact";

import type { EntryContent } from "../../../domain/journal/drafts";
import { FEELINGS } from "../../../domain/journal/feelings";
import { PROMPTS, type PromptKey } from "../../../domain/journal/types";
import { ANSWER_NEEDED } from "../../../domain/journal/validation";
import { Button } from "../../components/Button";
import { CheckboxGroup } from "../../components/CheckboxGroup";
import { TextArea } from "../../components/Field";
import { StatusBanner } from "../../components/StatusBanner";

/** Props for {@link EntryFields}. */
export interface EntryFieldsProps {
  readonly content: EntryContent;
  /** The prompts whose answers are to be marked as still needed. */
  readonly missing: readonly PromptKey[];
  readonly onChange: (content: EntryContent) => void;
}

/**
 * The fields of a journal entry: the three prompts, in order, each with a
 * text box, then the optional feelings check-in (PRD JR-001 to JR-003).
 * Used for writing a new entry and for editing a saved one.
 *
 * @param props - See {@link EntryFieldsProps}.
 * @returns The fields.
 */
export function EntryFields(props: EntryFieldsProps): JSX.Element {
  const { responses, feelings } = props.content;
  return (
    <>
      {PROMPTS.map((prompt) => (
        <TextArea
          key={prompt.key}
          label={prompt.label}
          name={`journal-${prompt.key}`}
          rows={5}
          required
          value={responses[prompt.key]}
          error={props.missing.includes(prompt.key) ? ANSWER_NEEDED : undefined}
          onInput={(value) => {
            props.onChange({
              responses: { ...responses, [prompt.key]: value },
              feelings,
            });
          }}
        />
      ))}
      <CheckboxGroup
        legend="How are you feeling? (optional)"
        hint="Choose any that fit, or none. Only what you choose is noted."
        name="journal-feelings"
        options={FEELINGS}
        selected={feelings}
        onChange={(chosen) => {
          props.onChange({ responses, feelings: chosen });
        }}
      />
    </>
  );
}

/**
 * Said when a save was refused because the record was changed elsewhere,
 * with the way to carry on. The newer version is never replaced silently.
 *
 * @param props - `what` names the record ("draft" or "entry"); `onLoad`
 *   reads the newer version onto the form.
 * @returns The banner.
 */
export function OutOfDate(props: {
  readonly what: "draft" | "entry";
  readonly disabled: boolean;
  readonly onLoad: () => void;
}): JSX.Element {
  return (
    <StatusBanner tone="warning" label="Changed somewhere else">
      This {props.what} was changed in another tab or window, or on another of
      your devices, so what is here was not saved over it. Loading the latest
      version replaces what you have typed here. Copy anything you want to keep
      first.
      <div class="button-row">
        <Button disabled={props.disabled} onClick={props.onLoad}>
          Load the latest version
        </Button>
      </div>
    </StatusBanner>
  );
}
