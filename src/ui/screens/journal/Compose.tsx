import type { JSX } from "preact";
import { useContext, useRef, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import type { SaveState } from "../../../domain/journal/drafts";
import { FEELINGS } from "../../../domain/journal/feelings";
import { PROMPTS } from "../../../domain/journal/types";
import {
  ANSWER_NEEDED,
  canComplete,
  unanswered,
} from "../../../domain/journal/validation";
import { Button } from "../../components/Button";
import { CheckboxGroup } from "../../components/CheckboxGroup";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextArea } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { AccountForm, useAction } from "../account/shared";
import { CANNOT_OPEN, formatEntryDate } from "./shared";
import { useDraft } from "./useDraft";

/** Said once a draft is stored. */
export const DRAFT_SAVED = "Saved on this device";
/** Said when a draft could not be stored. */
export const DRAFT_NOT_SAVED =
  "This draft couldn't be saved on this device. Keep this page open so what you wrote isn't lost. If the journal is open in another tab, close this one and carry on there.";

/**
 * Where the draft stands, in words. Only a settled state is announced to a
 * screen reader: "Saving" comes and goes with every pause in typing, so it
 * is shown but not read out.
 */
function SaveStatus(props: { readonly state: SaveState }): JSX.Element {
  // The last settled message stays in the live region while a save is
  // under way, so it is not announced again after every pause.
  const settled = useRef("");
  if (props.state === "saved") {
    settled.current = DRAFT_SAVED;
  } else if (props.state === "failed") {
    settled.current = DRAFT_NOT_SAVED;
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

/**
 * Write a new journal entry: the three prompts, in order, each with a text
 * box, then an optional feelings check-in (PRD JR-001 to JR-004).
 *
 * What is typed is saved as a draft as it goes, and a stored draft is
 * picked up when the screen opens. The entry is completed only when every
 * answer has some text (JR-002; AC-02). There is no control that skips a
 * question. Nothing here makes a network request or calls AI.
 *
 * @returns The compose screen.
 */
export function Compose(): JSX.Element {
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const form = useDraft();
  const [discarding, setDiscarding] = useState(false);
  // Errors appear only once the person has tried to save, and then follow
  // what they type, so a message goes as soon as its answer has text.
  const [tried, setTried] = useState(false);
  const { responses, feelings } = form.content;
  const missing = tried ? unanswered(responses) : [];

  if (form.status !== "ready") {
    return (
      <PageLayout title="New journal entry">
        {form.status === "loading" ? (
          <StatusBanner tone="info" label="Loading">
            Looking for a draft.
          </StatusBanner>
        ) : (
          <StatusBanner tone="error" label="Couldn't open your journal">
            {CANNOT_OPEN}
          </StatusBanner>
        )}
        <p>
          <Link href={pathFor("journal")}>Back to your journal</Link>
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="New journal entry"
      lead="Three questions. Answer in your own words; there are no wrong answers."
    >
      {form.resumed !== undefined && (
        <StatusBanner tone="info" label="Your draft">
          You're carrying on with the draft you started on{" "}
          {formatEntryDate(form.resumed)}.
        </StatusBanner>
      )}
      <AccountForm
        action={action}
        validate={() => {
          setTried(true);
          return canComplete(responses);
        }}
        onValid={async () => {
          const entry = await form.complete();
          if (entry === undefined) {
            // The app locked while the entry was being prepared. The locked
            // screen is already showing; there is nothing more to do here.
            return;
          }
          navigate(pathFor("journal-entry", { id: entry.id }));
        }}
      >
        <p>
          Each question needs an answer before the entry is finished. If nothing
          comes to mind for one, say so in your own words. That is a real
          answer. What you write is saved as a draft as you go.
        </p>
        {PROMPTS.map((prompt) => (
          <TextArea
            key={prompt.key}
            label={prompt.label}
            name={`journal-${prompt.key}`}
            rows={5}
            required
            value={responses[prompt.key]}
            error={missing.includes(prompt.key) ? ANSWER_NEEDED : undefined}
            onInput={(value) => {
              form.change({
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
            form.change({ responses, feelings: chosen });
          }}
        />
        <SaveStatus state={form.saveState} />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Save entry
          </Button>
          {form.hasDraft && (
            <Button
              disabled={action.busy}
              onClick={() => {
                setDiscarding(true);
              }}
            >
              Discard draft
            </Button>
          )}
        </div>
      </AccountForm>
      <ConfirmDialog
        open={discarding}
        title="Discard this draft?"
        confirmLabel="Discard draft"
        cancelLabel="Keep writing"
        destructive
        onCancel={() => {
          setDiscarding(false);
        }}
        onConfirm={() => {
          setDiscarding(false);
          setTried(false);
          action.run(form.discard);
        }}
      >
        What you have written here will be deleted for good. There is no way to
        get it back.
      </ConfirmDialog>
      <p>
        <Link href={pathFor("journal")}>Back to your journal</Link>
      </p>
    </PageLayout>
  );
}
