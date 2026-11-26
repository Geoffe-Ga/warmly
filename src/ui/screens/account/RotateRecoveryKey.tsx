import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ActionForm, useAction } from "../../components/ActionForm";
import { sameLastGroup } from "./shared";

const TITLE = "Replace your recovery key";

/**
 * Replace the recovery key in three steps: prove you hold the current key,
 * save the new one, then confirm you saved it. The old key keeps working
 * until the last step succeeds, so stopping part-way changes nothing (PRD
 * SEC-003).
 *
 * The new key is held in this component's state only. Leaving the screen
 * discards it.
 *
 * @returns The replace-recovery-key screen.
 */
export function RotateRecoveryKey(): JSX.Element {
  const { vault } = useServices();
  const action = useAction();
  const [current, setCurrent] = useState("");
  const [newKey, setNewKey] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <PageLayout
        back={{ href: pathFor("settings"), label: "Back to settings" }}
        title={TITLE}
      >
        <StatusBanner tone="success" label="Recovery key replaced">
          Your new key is the only one that works now. The old key can be thrown
          away.
        </StatusBanner>
      </PageLayout>
    );
  }

  if (newKey === undefined) {
    return (
      <PageLayout
        back={{ href: pathFor("settings"), label: "Back to settings" }}
        title={TITLE}
        lead="First, enter the recovery key you have now."
      >
        <StatusBanner tone="info" label="Good to know">
          Your current key keeps working until you finish. If you stop part-way,
          nothing changes.
        </StatusBanner>
        <ActionForm
          action={action}
          validate={() => {
            const missing = current.trim() === "";
            setError(missing ? "Enter your current recovery key." : undefined);
            return !missing;
          }}
          onValid={async () => {
            setNewKey(await vault.beginRecoveryKeyRotation(current));
            setCurrent("");
            setError(undefined);
          }}
        >
          <TextField
            label="Current recovery key"
            name="current-recovery-key"
            autocomplete="off"
            required
            hint="Groups of letters and numbers separated by dashes. Capitals and spaces don't matter."
            value={current}
            onInput={setCurrent}
            error={error}
          />
          <div class="button-row">
            <Button type="submit" variant="primary" disabled={action.busy}>
              Continue
            </Button>
          </div>
        </ActionForm>
        <p>
          <Link href={pathFor("settings")}>Cancel</Link>
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      back={{ href: pathFor("settings"), label: "Back to settings" }}
      title={TITLE}
      lead="Write the new key down or store it in a password manager before you continue."
    >
      <Card heading="Your new recovery key">
        <p class="recovery-key" data-testid="recovery-key">
          {newKey}
        </p>
        <p>
          It isn't active yet. When you confirm below, this key replaces your
          old one, and the old one stops working.
        </p>
      </Card>
      <ActionForm
        action={action}
        validate={() => {
          const matches = sameLastGroup(typed, newKey);
          setError(
            matches
              ? undefined
              : "That doesn't match the last group of your new key. Check it and try again.",
          );
          return matches;
        }}
        onValid={async () => {
          await vault.confirmRecoveryKeyRotation();
          setNewKey(undefined);
          setTyped("");
          setDone(true);
        }}
      >
        <TextField
          label="Type the last group of your new key"
          name="recovery-key-check"
          autocomplete="off"
          required
          hint="This checks that you saved it."
          value={typed}
          onInput={setTyped}
          error={error}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Replace my recovery key
          </Button>
        </div>
      </ActionForm>
      <p>
        <Link href={pathFor("settings")}>Cancel and keep my current key</Link>
      </p>
    </PageLayout>
  );
}
