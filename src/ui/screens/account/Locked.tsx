import type { JSX } from "preact";
import { useContext } from "preact/hooks";

import { HOME_PATH } from "../../../app/access";
import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { PageLayout } from "../../components/PageLayout";
import { AccountForm, useAction } from "./shared";

/**
 * The locked screen (PRD DEV-005, UI-008). It shows nothing private: no
 * entries, counts, titles or dates. It offers unlocking on this device, the
 * recovery key, and signing out.
 *
 * @returns The locked screen.
 */
export function Locked(): JSX.Element {
  const { vault, session } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();

  return (
    <PageLayout
      title="Warmly is locked"
      lead="Your journal is closed. Unlock it to continue."
    >
      <AccountForm
        action={action}
        validate={() => true}
        onValid={async () => {
          await vault.unlock();
          session.unlock();
          navigate(HOME_PATH);
        }}
      >
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Unlock
          </Button>
        </div>
      </AccountForm>
      <p>
        <Link href={pathFor("recover")}>Use your recovery key instead</Link>
      </p>
    </PageLayout>
  );
}
