import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  PROMPTS,
  type PromptKey,
  type Responses,
} from "../../../domain/journal/types";
import { Button } from "../../components/Button";
import { TextArea } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { AccountForm, useAction } from "../account/shared";
import { NOT_SAVED_YET, saveNewEntry } from "./shared";

const EMPTY: Responses = { good: "", improve: "", loved: "" };

/**
 * Write a new journal entry: the three prompts, in order, each with a text
 * box (PRD JR-001). Saving never calls AI. Checking the answers, drafts and
 * the feelings check-in arrive with later work.
 *
 * @returns The compose screen.
 */
export function Compose(): JSX.Element {
  const services = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [responses, setResponses] = useState<Responses>(EMPTY);

  const answer = (key: PromptKey, value: string): void => {
    setResponses((current) => ({ ...current, [key]: value }));
  };

  return (
    <PageLayout
      title="New journal entry"
      lead="Three questions. Answer in your own words; there are no wrong answers."
    >
      <StatusBanner tone="warning" label="Not saved yet">
        {NOT_SAVED_YET}
      </StatusBanner>
      <AccountForm
        action={action}
        validate={() => true}
        onValid={async () => {
          const entry = await saveNewEntry(services, responses);
          if (entry === undefined) {
            // The app locked while the entry was being prepared. The locked
            // screen is already showing; there is nothing more to do here.
            return;
          }
          setResponses(EMPTY);
          navigate(pathFor("journal-entry", { id: entry.id }));
        }}
      >
        {PROMPTS.map((prompt) => (
          <TextArea
            key={prompt.key}
            label={prompt.label}
            name={`journal-${prompt.key}`}
            rows={5}
            value={responses[prompt.key]}
            onInput={(value) => {
              answer(prompt.key, value);
            }}
          />
        ))}
        <p>
          If nothing comes to mind for a question, you can say so in your own
          words. That is a real answer.
        </p>
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
