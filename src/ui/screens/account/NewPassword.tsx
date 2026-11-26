import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ActionForm, useAction } from "../../components/ActionForm";
import { MIN_PASSWORD_LENGTH, newPasswordError } from "./shared";

/**
 * Choose a new password after following the emailed reset link. The user is
 * left signed out and signs in with the new password. Like the screen that
 * sends the link, it says plainly that a password does not unlock the journal
 * (PRD DEV-006).
 *
 * @returns The new-password screen.
 */
export function NewPassword(): JSX.Element {
  const { auth } = useServices();
  const action = useAction();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <PageLayout title="Choose a new password">
        <StatusBanner tone="success" label="Password changed">
          Sign in with your new password. To open your journal you still need a
          device you already use, or your recovery key.
        </StatusBanner>
        <p>
          <Link href={pathFor("sign-in")}>Sign in</Link>
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Choose a new password"
      lead="You opened the reset link we emailed you. Choose a new password to finish."
    >
      <ActionForm
        action={action}
        validate={() => {
          const problem = newPasswordError(password);
          setError(problem);
          return problem === undefined;
        }}
        onValid={async () => {
          await auth.completePasswordReset(password);
          setPassword("");
          setDone(true);
        }}
      >
        <TextField
          label="New password"
          type="password"
          name="new-password"
          autocomplete="new-password"
          required
          hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters. It signs you in; it does not unlock your journal.`}
          value={password}
          onInput={setPassword}
          error={error}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Save new password
          </Button>
        </div>
      </ActionForm>
      <p>
        Link not working?{" "}
        <Link href={pathFor("reset-password")}>Send a new one</Link>
      </p>
    </PageLayout>
  );
}
