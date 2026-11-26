import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { HOME_PATH } from "../../../app/access";
import { NavigationContext } from "../../../app/navigation";
import { useServices } from "../../../app/services";
import { MIN_DEVICE_PASSPHRASE_LENGTH } from "../../../crypto/device-key-store";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ActionForm, useAction } from "../../components/ActionForm";

interface FieldErrors {
  readonly passphrase?: string | undefined;
  readonly again?: string | undefined;
}

/**
 * Offer to make this device trusted, just after the journal was opened with
 * the recovery key. The user sets a passphrase for this device, which then
 * unlocks it instead of the recovery key (ADR-0004, PRD DEV-005). They may
 * decline, and the offer is made again the next time they use the recovery
 * key.
 *
 * @returns The trust-this-device screen.
 */
export function TrustDevice(): JSX.Element {
  const { vault } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  if (!vault.deviceTrustPending()) {
    return (
      <PageLayout title="Unlock this device more easily">
        <StatusBanner tone="info" label="Nothing to set up right now">
          To set a passphrase for this device, lock Warmly and unlock it with
          your recovery key.
        </StatusBanner>
      </PageLayout>
    );
  }

  const validate = (): boolean => {
    const next = {
      passphrase:
        passphrase.length >= MIN_DEVICE_PASSPHRASE_LENGTH
          ? undefined
          : `Use at least ${String(MIN_DEVICE_PASSPHRASE_LENGTH)} characters.`,
      again:
        again === passphrase
          ? undefined
          : "The two passphrases don't match. Type the same one in both boxes.",
    };
    setErrors(next);
    return next.passphrase === undefined && next.again === undefined;
  };

  return (
    <PageLayout
      title="Unlock this device more easily"
      lead="Set a passphrase for this device, so you don't need your recovery key every time."
    >
      <StatusBanner tone="info" label="Good to know">
        The passphrase only works on this device. It is not your account
        password, and it is never sent anywhere. If you forget it, your recovery
        key still opens your journal.
      </StatusBanner>
      <ActionForm
        action={action}
        validate={validate}
        onValid={async () => {
          await vault.trustThisDevice(passphrase);
          setPassphrase("");
          setAgain("");
          navigate(HOME_PATH);
        }}
      >
        <TextField
          label="Device passphrase"
          type="password"
          name="device-passphrase"
          autocomplete="off"
          required
          hint={`At least ${String(MIN_DEVICE_PASSPHRASE_LENGTH)} characters. A few unrelated words work well.`}
          value={passphrase}
          onInput={setPassphrase}
          error={errors.passphrase}
        />
        <TextField
          label="Type it again"
          type="password"
          name="device-passphrase-again"
          autocomplete="off"
          required
          value={again}
          onInput={setAgain}
          error={errors.again}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Trust this device
          </Button>
          <Button
            onClick={() => {
              vault.skipDeviceTrust();
              navigate(HOME_PATH);
            }}
          >
            Not now
          </Button>
        </div>
      </ActionForm>
      <p>
        If you choose Not now, this device will ask for your recovery key each
        time it is unlocked.
      </p>
    </PageLayout>
  );
}
