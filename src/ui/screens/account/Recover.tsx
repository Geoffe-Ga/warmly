import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { AccountForm, afterRecoveryKey, useAction } from "./shared";

/**
 * Unlock on a device that has no stored key, using the recovery key.
 *
 * @returns The recovery screen.
 */
export function Recover(): JSX.Element {
  const { vault, session } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [recoveryKey, setRecoveryKey] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <PageLayout
      title="Unlock with your recovery key"
      lead="Enter the key you saved when you created your account."
    >
      <AccountForm
        action={action}
        validate={() => {
          const missing = recoveryKey.trim() === "";
          setError(missing ? "Enter your recovery key." : undefined);
          return !missing;
        }}
        onValid={async () => {
          await vault.unlockWithRecoveryKey(recoveryKey);
          if (session.state !== "signed_in_locked") {
            // The session ended while the keys were being opened, for
            // example by a sign-out. Never leave keys open without it.
            vault.lock();
            return;
          }
          session.unlock();
          navigate(afterRecoveryKey(vault));
        }}
      >
        <TextField
          label="Recovery key"
          name="recovery-key"
          autocomplete="off"
          required
          hint="Groups of letters and numbers separated by dashes. Capitals and spaces don't matter."
          value={recoveryKey}
          onInput={setRecoveryKey}
          error={error}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Unlock
          </Button>
        </div>
      </AccountForm>
      <p>
        <Link href={pathFor("locked")}>Back</Link>
      </p>
    </PageLayout>
  );
}
