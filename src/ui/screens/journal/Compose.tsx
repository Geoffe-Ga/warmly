import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { FEELINGS, type Feeling } from "../../../domain/journal/feelings";
import {
  PROMPTS,
  type PromptKey,
  type Responses,
} from "../../../domain/journal/types";
import {
  ANSWER_NEEDED,
  canComplete,
  unanswered,
} from "../../../domain/journal/validation";
import { Button } from "../../components/Button";
import { CheckboxGroup } from "../../components/CheckboxGroup";
import { TextArea } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { AccountForm, useAction } from "../account/shared";
import { saveNewEntry } from "./shared";

const EMPTY: Responses = { good: "", improve: "", loved: "" };

/**
 * Write a new journal entry: the three prompts, in order, each with a text
 * box, then an optional feelings check-in (PRD JR-001 to JR-003).
 *
 * The entry is saved only when every answer has some text (JR-002; AC-02).
 * There is no control that skips a question. Saving makes no network
 * request and never calls AI. Drafts arrive with later work.
 *
 * @returns The compose screen.
 */
export function Compose(): JSX.Element {
  const services = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [responses, setResponses] = useState<Responses>(EMPTY);
  const [feelings, setFeelings] = useState<readonly Feeling[]>([]);
  // Errors appear only once the person has tried to save, and then follow
  // what they type, so a message goes as soon as its answer has text.
  const [tried, setTried] = useState(false);
  const missing = tried ? unanswered(responses) : [];

  const answer = (key: PromptKey, value: string): void => {
    setResponses((current) => ({ ...current, [key]: value }));
  };

  return (
    <PageLayout
      title="New journal entry"
      lead="Three questions. Answer in your own words; there are no wrong answers."
    >
      <AccountForm
        action={action}
        validate={() => {
          setTried(true);
          return canComplete(responses);
        }}
        onValid={async () => {
          const entry = await saveNewEntry(services, responses, feelings);
          if (entry === undefined) {
            // The app locked while the entry was being prepared. The locked
            // screen is already showing; there is nothing more to do here.
            return;
          }
          setResponses(EMPTY);
          setFeelings([]);
          setTried(false);
          navigate(pathFor("journal-entry", { id: entry.id }));
        }}
      >
        <p>
          Each question needs an answer before the entry is saved. If nothing
          comes to mind for one, say so in your own words. That is a real
          answer.
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
              answer(prompt.key, value);
            }}
          />
        ))}
        <CheckboxGroup
          legend="How are you feeling? (optional)"
          hint="Choose any that fit, or none. Only what you choose is noted."
          name="journal-feelings"
          options={FEELINGS}
          selected={feelings}
          onChange={setFeelings}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Save entry
          </Button>
        </div>
      </AccountForm>
      <p>
        <Link href={pathFor("journal")}>Back to your journal</Link>
      </p>
    </PageLayout>
  );
}
