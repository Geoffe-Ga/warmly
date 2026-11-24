import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { AccountForm, useAction } from "./shared";

/**
 * Wait for the user to follow the emailed link, then create their keys and
 * move on to the recovery key.
 *
 * @returns The email-verification screen.
 */
export function VerifyEmail(): JSX.Element {
  const { auth, vault, session, onboarding } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [notYet, setNotYet] = useState(false);

  return (
    <PageLayout
      title="Check your email"
      lead="We sent a link to the address you gave. Open it, then come back here."
    >
      <AccountForm
        action={action}
        validate={() => true}
        onValid={async () => {
          // Verification can only be completed once. Remember that it
          // succeeded, so that if creating the keys fails the user can press
          // the button again and only the failed step is retried.
          if (!onboarding.emailVerified) {
            const verified = await auth.completeVerification();
            setNotYet(!verified);
            if (!verified) {
              return;
            }
            onboarding.markEmailVerified();
          }
          onboarding.holdRecoveryKey(await vault.createAccountKeys());
          // Change the session and the destination together, with no await
          // between them, so the access rules never see one without the other.
          if (session.state === "signed_out") {
            session.signIn();
          }
          navigate(pathFor("recovery-key"));
        }}
      >
        {notYet && (
          <StatusBanner tone="warning" label="Not verified yet">
            We couldn't confirm your email. Open the link in the message, then
            try again.
          </StatusBanner>
        )}
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            I've opened the link
          </Button>
        </div>
      </AccountForm>
      <p>
        Wrong address? <Link href={pathFor("onboarding")}>Start again</Link>
      </p>
    </PageLayout>
  );
}
