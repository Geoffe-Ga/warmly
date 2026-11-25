import type { JSX } from "preact";
import { useState } from "preact/hooks";

import type { ReflectRequest } from "../../ai/provider";
import { AiDisclosureDialog } from "../components/AiDisclosureDialog";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CheckboxGroup } from "../components/CheckboxGroup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TextArea, TextField } from "../components/Field";
import { PageLayout } from "../components/PageLayout";
import { StatusBanner } from "../components/StatusBanner";

/** A synthetic request for the disclosure sample. It is never sent. */
const SAMPLE_REQUEST: ReflectRequest = {
  kind: "reflect",
  question: "Synthetic question",
  // Enough invented text to show what a large request looks like.
  entries: Array.from({ length: 14 }, (_, index) => ({
    id: `sample-entry-${String(index + 1)}`,
    contentHash: "0".repeat(64),
    responses: {
      good: "Synthetic sample text. ".repeat(20),
      improve: "Synthetic sample text. ".repeat(20),
      loved: "Synthetic sample text. ".repeat(20),
    },
  })),
};

/** Path of the gallery. It never exists in a production build. */
export const GALLERY_PATH = "/dev/components";

/**
 * Every component in the kit on one page, with synthetic content. Used for
 * visual review and for the Playwright accessibility check of the kit. It is
 * never part of a production build.
 *
 * @returns The gallery screen.
 */
export function Gallery(): JSX.Element {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [feelings, setFeelings] = useState<string[]>(["calm"]);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("Nothing chosen yet.");
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState("Nothing sent yet.");

  return (
    <PageLayout title="Component gallery" lead="Synthetic content only.">
      <Card heading="Buttons">
        <div class="button-row">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Unavailable</Button>
        </div>
      </Card>

      <Card heading="Fields">
        <div class="stack">
          <TextField
            label="Device name"
            hint="Only you can see this."
            value={name}
            onInput={setName}
          />
          <TextField
            label="Email"
            type="email"
            autocomplete="email"
            value=""
            error="Enter an email address, like name@example.com."
            onInput={() => undefined}
          />
          <TextArea
            label="What's going well?"
            hint="Write as much or as little as you like."
            value={note}
            onInput={setNote}
          />
          <CheckboxGroup
            legend="How are you feeling?"
            hint="Choose any that fit, or none."
            options={["calm", "tired", "hopeful"]}
            selected={feelings}
            onChange={setFeelings}
          />
        </div>
      </Card>

      <Card heading="Status">
        <div class="stack">
          <StatusBanner tone="info" label="Offline">
            Your writing is saved on this device.
          </StatusBanner>
          <StatusBanner tone="success" label="Saved">
            All changes are synced.
          </StatusBanner>
          <StatusBanner tone="warning" label="Needs your attention">
            Two versions of an entry need a decision.
          </StatusBanner>
          <StatusBanner tone="error" label="Couldn't save">
            Storage on this device is full.
          </StatusBanner>
        </div>
      </Card>

      <Card heading="Confirm dialog">
        <p>{outcome}</p>
        <Button
          variant="danger"
          onClick={() => {
            setOpen(true);
          }}
        >
          Delete sample
        </Button>
        <ConfirmDialog
          open={open}
          title="Delete this sample?"
          confirmLabel="Delete sample"
          destructive
          onConfirm={() => {
            setOpen(false);
            setOutcome("You chose to delete.");
          }}
          onCancel={() => {
            setOpen(false);
            setOutcome("You cancelled.");
          }}
        >
          <p>This cannot be undone.</p>
        </ConfirmDialog>
      </Card>

      <Card heading="AI disclosure">
        <p role="status">{sent}</p>
        <Button
          onClick={() => {
            setAsking(true);
          }}
        >
          Ask before sending
        </Button>
        <AiDisclosureDialog
          open={asking}
          request={SAMPLE_REQUEST}
          onConfirm={() => {
            setAsking(false);
            setSent("You chose to send.");
          }}
          onCancel={() => {
            setAsking(false);
            setSent("Nothing was sent.");
          }}
        />
      </Card>
    </PageLayout>
  );
}
