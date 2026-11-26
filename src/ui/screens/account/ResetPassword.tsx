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
import { emailError } from "./shared";

/**
 * Ask for a password-reset link. The confirmation is the same for every
 * address, so it never reveals who has an account, and it states plainly that
 * a new password does not unlock the journal (PRD DEV-006).
 *
 * @returns The password-reset screen.
 */
export function ResetPassword(): JSX.Element {
  const { auth } = useServices();
  const action = useAction();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);

  return (
    <PageLayout
      title="Reset your password"
      lead="We'll email you a link to choose a new password."
    >
      <StatusBanner tone="info" label="Good to know">
        A new password signs you in. It does not unlock your journal: for that
        you need a device you already use, or your recovery key.
      </StatusBanner>
      {sent && (
        <StatusBanner tone="success" label="Check your email">
          If that address has an account, a reset link is on its way.
        </StatusBanner>
      )}
      <ActionForm
        action={action}
        validate={() => {
          setError(emailError(email));
          return emailError(email) === undefined;
        }}
        onValid={async () => {
          setSent(false);
          await auth.requestPasswordReset(email.trim());
          setSent(true);
        }}
      >
        <TextField
          label="Email"
          type="email"
          name="email"
          autocomplete="email"
          required
          value={email}
          onInput={setEmail}
          error={error}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Send reset link
          </Button>
        </div>
      </ActionForm>
      <p>
        <Link href={pathFor("sign-in")}>Back to sign in</Link>
      </p>
    </PageLayout>
  );
}
