import type { JSX } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  PairingError,
  formatPairingCode,
  type JoinProgress,
} from "../../../devices/pairing";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { afterRecoveryKey, describeError } from "../account/shared";

/** Where the pairing has got to on this, the new, device. */
type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "failed"; readonly message: string }
  | JoinProgress;

/**
 * Open the journal on a new device with the help of one that is already
 * unlocked (PRD DEV-001 path A, AC-19). This device shows a six-digit code;
 * the person types it into the other device, which then sends the account
 * key, encrypted so that only this device can read it.
 *
 * @returns The screen a new device shows while it is being approved.
 */
export function AddDevice(): JSX.Element {
  const { pairing, vault, session } = useServices();
  const { navigate } = useContext(NavigationContext);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const running = useRef<AbortController | undefined>(undefined);

  // Leaving the screen ends the request.
  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const start = (): void => {
    if (running.current !== undefined) {
      return;
    }
    const abort = new AbortController();
    running.current = abort;
    pairing
      .join((progress) => {
        setStep(progress);
      }, abort.signal)
      .then(
        () => {
          if (session.state !== "signed_in_locked") {
            // The session ended while the key was on its way, for example
            // by a sign-out. Never leave keys open without it.
            vault.lock();
            return;
          }
          session.unlock();
          navigate(afterRecoveryKey(vault));
        },
        (error: unknown) => {
          running.current = undefined;
          if (
            !(error instanceof PairingError) ||
            error.code !== "pairing_cancelled"
          ) {
            setStep({ kind: "failed", message: describeError(error) });
          }
        },
      );
  };

  return (
    <PageLayout
      title="Approve from another device"
      lead="If Warmly is open and unlocked on another of your devices, it can let this one in."
    >
      {step.kind === "failed" && (
        <StatusBanner tone="error" label="Not approved">
          {step.message}
        </StatusBanner>
      )}
      {(step.kind === "idle" || step.kind === "failed") && (
        <>
          <Card heading="How it works">
            <p>
              This device will show a six-digit code. On your other device, open
              Manage Devices, choose Approve a new device, and type the code
              there. The code proves the two devices are talking to each other
              and not to someone in between.
            </p>
          </Card>
          <div class="button-row">
            <Button variant="primary" onClick={start}>
              {step.kind === "failed" ? "Start again" : "Show a code"}
            </Button>
          </div>
        </>
      )}
      {step.kind === "waiting_for_approver" && (
        <StatusBanner tone="info" label="Waiting for your other device">
          On your other device, open Manage Devices and choose Approve a new
          device. Keep this screen open. The code will appear here.
        </StatusBanner>
      )}
      {step.kind === "compare_code" && (
        <Card heading="Type this code on your other device">
          <p
            class="recovery-key"
            data-testid="pairing-code"
            aria-label={`Code: ${[...step.code].join(" ")}`}
          >
            {formatPairingCode(step.code)}
          </p>
          <p>
            Only type it into a device you are holding. If nobody is asking you
            for a code, do nothing, and this request will run out in five
            minutes.
          </p>
        </Card>
      )}
      <p>
        <Link href={pathFor("recover")}>Use your recovery key instead</Link>
      </p>
    </PageLayout>
  );
}
