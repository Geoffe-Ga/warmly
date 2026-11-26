import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  PairingError,
  formatPairingCode,
  normalisePairingCode,
  type Approval,
  type RootKeyCredential,
} from "../../../devices/pairing";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ActionForm, useAction } from "../../components/ActionForm";
import { describeError } from "../../error-messages";

/** Where the approval has got to on this, the unlocked, device. */
type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "none_waiting" }
  | { readonly kind: "ended"; readonly message: string }
  | { readonly kind: "refused" }
  | { readonly kind: "approved"; readonly confirmation: string }
  | { readonly kind: "found"; readonly approval: Approval };

interface FieldErrors {
  readonly code?: string | undefined;
  readonly secret?: string | undefined;
}

function ApprovalForm(props: {
  readonly approval: Approval;
  readonly trusted: boolean;
  readonly onStep: (step: Step) => void;
}): JSX.Element {
  const action = useAction();
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const next = {
      code:
        normalisePairingCode(code).length === 6
          ? undefined
          : "Type the six digits shown on the new device.",
      secret:
        secret.trim() === ""
          ? props.trusted
            ? "Enter this device's passphrase."
            : "Enter your recovery key."
          : undefined,
    };
    setErrors(next);
    return next.code === undefined && next.secret === undefined;
  };

  const credential = (): RootKeyCredential =>
    props.trusted
      ? { kind: "device_passphrase", passphrase: secret }
      : { kind: "recovery_key", recoveryKey: secret };

  return (
    <ActionForm
      action={action}
      validate={validate}
      onValid={async () => {
        let confirmation: string;
        try {
          confirmation = await props.approval.approve(code, credential());
        } catch (error) {
          if (error instanceof PairingError) {
            // The request is over. A wrong passphrase, by contrast, is
            // reported by the form and can be corrected.
            props.onStep({ kind: "ended", message: describeError(error) });
            return;
          }
          throw error;
        }
        setSecret("");
        props.onStep({ kind: "approved", confirmation });
      }}
    >
      <StatusBanner tone="warning" label="Check first">
        Only approve a device you are holding right now. Approving gives it
        everything in your journal.
      </StatusBanner>
      <TextField
        label="Code on the new device"
        name="pairing-code"
        autocomplete="off"
        required
        hint="Six digits. Spaces don't matter. You get one try; a wrong code cancels the request."
        value={code}
        onInput={setCode}
        error={errors.code}
      />
      <TextField
        label={props.trusted ? "This device's passphrase" : "Recovery key"}
        type="password"
        name="approval-secret"
        autocomplete="off"
        required
        hint="Confirms it is you. It is used on this device only and is not sent anywhere."
        value={secret}
        onInput={setSecret}
        error={errors.secret}
      />
      <div class="button-row">
        <Button type="submit" variant="primary" disabled={action.busy}>
          Approve this device
        </Button>
        <Button
          onClick={() => {
            props.approval.reject().then(
              () => {
                props.onStep({ kind: "refused" });
              },
              (error: unknown) => {
                props.onStep({ kind: "ended", message: describeError(error) });
              },
            );
          }}
        >
          Don't approve
        </Button>
      </div>
    </ActionForm>
  );
}

/**
 * Approve a new device from this unlocked one (PRD DEV-001 path A, AC-19).
 * The person types the code the new device shows and confirms with this
 * device's passphrase or the recovery key. Only then is the account key
 * sent, encrypted so that only the new device can read it. This device then
 * shows a confirmation code for the person to type into the new one.
 *
 * @returns The screen an unlocked device shows to approve another.
 */
export function ApproveDevice(): JSX.Element {
  const { pairing, vault } = useServices();
  const action = useAction();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [trusted, setTrusted] = useState(false);
  const leaving = useRef(new AbortController());

  useEffect(() => {
    const abort = leaving.current;
    return () => {
      abort.abort();
    };
  }, []);

  const look = (): void => {
    action.run(async () => {
      setTrusted(await vault.hasKeysOnThisDevice());
      const approval = await pairing.takeUpRequest(leaving.current.signal);
      setStep(
        approval === undefined
          ? { kind: "none_waiting" }
          : { kind: "found", approval },
      );
    });
  };

  const canLook = step.kind !== "found" && step.kind !== "approved";

  return (
    <PageLayout
      title="Approve a new device"
      lead="Let a device you are signing in on open your journal, without typing your recovery key there."
    >
      {action.error !== undefined && (
        <StatusBanner tone="error" label="Couldn't continue">
          {action.error}
        </StatusBanner>
      )}
      {step.kind === "none_waiting" && (
        <StatusBanner tone="info" label="No device is waiting">
          On the new device, sign in, choose Approve from another device, and
          press Show a code. Then look again here.
        </StatusBanner>
      )}
      {step.kind === "ended" && (
        <StatusBanner tone="error" label="Not approved">
          {step.message}
        </StatusBanner>
      )}
      {step.kind === "refused" && (
        <StatusBanner tone="info" label="Not approved">
          You didn't approve that device. Nothing was shared with it.
        </StatusBanner>
      )}
      {step.kind === "approved" && (
        <>
          <StatusBanner tone="success" label="Approved">
            One more step. Type the confirmation code below into the new device
            to finish.
          </StatusBanner>
          <Card heading="Type this code on the new device">
            <p
              class="recovery-key"
              data-testid="confirmation-code"
              aria-label={`Code: ${[...step.confirmation].join(" ")}`}
            >
              {formatPairingCode(step.confirmation)}
            </p>
            <p>
              It proves to the new device that its key came from this one. The
              new device will appear in Manage Devices once it has finished.
            </p>
          </Card>
        </>
      )}
      {step.kind === "idle" && (
        <p>
          Start on the new device: sign in, choose Approve from another device,
          and press Show a code. Then look for it here.
        </p>
      )}
      {step.kind === "found" && (
        <ApprovalForm
          approval={step.approval}
          trusted={trusted}
          onStep={setStep}
        />
      )}
      {canLook && (
        <div class="button-row">
          <Button variant="primary" disabled={action.busy} onClick={look}>
            {step.kind === "idle" ? "Look for a new device" : "Look again"}
          </Button>
        </div>
      )}
      <p>
        <Link href={pathFor("devices")}>Back to Manage Devices</Link>
      </p>
    </PageLayout>
  );
}
