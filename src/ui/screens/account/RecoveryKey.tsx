import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { HOME_PATH } from "../../../app/access";
import { NavigationContext } from "../../../app/navigation";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { AccountForm, sameLastGroup, useAction } from "./shared";

/**
 * Show the recovery key once and make the user confirm they stored it (PRD
 * DEV-006). The key exists only in memory: if it is gone, for example after a
 * reload, the screen says so instead of showing anything.
 *
 * @returns The recovery-key screen.
 */
export function RecoveryKey(): JSX.Element {
  const { vault, session, onboarding } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const recoveryKey = onboarding.recoveryKey;

  if (recoveryKey === undefined) {
    return (
      <PageLayout title="Save your recovery key">
        <StatusBanner tone="warning" label="Key no longer on screen">
          For your safety the recovery key is shown only once and is not kept.
          Unlock on this device to continue.
        </StatusBanner>
      </PageLayout>
    );
  }

  const validate = (): boolean => {
    const matches = sameLastGroup(typed, recoveryKey);
    setError(
      matches
        ? undefined
        : "That doesn't match the last group of your key. Check it and try again.",
    );
    return matches;
  };

  return (
    <PageLayout
      title="Save your recovery key"
      lead="Write this down or store it in a password manager before you continue."
    >
      <Card heading="Your recovery key">
        <p class="recovery-key" data-testid="recovery-key">
          {recoveryKey}
        </p>
        <p>
          This key is the only way to open your journal if you lose every device
          you use. We can't see it or reset it. If you lose the key and all your
          devices, your journal cannot be recovered by anyone.
        </p>
        <p>Resetting your password does not replace this key.</p>
      </Card>
      <AccountForm
        action={action}
        validate={validate}
        onValid={async () => {
          // Only now are the keys saved: the user has shown they hold the
          // recovery key. If saving fails, the key stays on screen so they
          // can try again.
          await vault.confirmRecoveryKey();
          onboarding.clear();
          session.unlock();
          navigate(HOME_PATH);
        }}
      >
        <TextField
          label="Type the last group of your key"
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
            I've saved my key
          </Button>
        </div>
      </AccountForm>
    </PageLayout>
  );
}
