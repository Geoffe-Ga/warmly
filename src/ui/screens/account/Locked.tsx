import type { JSX } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";

import { HOME_PATH } from "../../../app/access";
import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { AccountForm, useAction } from "./shared";

/**
 * The locked screen (PRD DEV-005, UI-008). It shows nothing private: no
 * entries, counts, titles or dates. A trusted device unlocks with its
 * passphrase; any device can use the recovery key; and the header offers
 * signing out.
 *
 * @returns The locked screen.
 */
export function Locked(): JSX.Element {
  const { vault, session } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  // Unknown until checked. Nothing is offered that might not work.
  const [trusted, setTrusted] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    vault.hasKeysOnThisDevice().then(
      (value) => {
        if (!cancelled) {
          setTrusted(value);
        }
      },
      () => {
        if (!cancelled) {
          setTrusted(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [vault]);

  return (
    <PageLayout
      title="Warmly is locked"
      lead="Your journal is closed. Unlock it to continue."
    >
      {trusted === true && (
        <AccountForm
          action={action}
          validate={() => {
            const missing = passphrase === "";
            setError(missing ? "Enter this device's passphrase." : undefined);
            return !missing;
          }}
          onValid={async () => {
            await vault.unlock(passphrase);
            setPassphrase("");
            if (session.state !== "signed_in_locked") {
              // The session ended while the keys were being opened, for
              // example by a sign-out. Never leave keys open without it.
              vault.lock();
              return;
            }
            session.unlock();
            navigate(HOME_PATH);
          }}
        >
          <TextField
            label="Device passphrase"
            type="password"
            name="device-passphrase"
            autocomplete="off"
            required
            hint="The passphrase you set for this device. It is not your account password."
            value={passphrase}
            onInput={setPassphrase}
            error={error}
          />
          <div class="button-row">
            <Button type="submit" variant="primary" disabled={action.busy}>
              Unlock
            </Button>
          </div>
        </AccountForm>
      )}
      {trusted === false && (
        <p>This device needs your recovery key to unlock.</p>
      )}
      {trusted !== undefined && (
        <p>
          <Link href={pathFor("recover")}>
            {trusted
              ? "Use your recovery key instead"
              : "Unlock with your recovery key"}
          </Link>
        </p>
      )}
    </PageLayout>
  );
}
