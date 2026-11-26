import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../app/navigation";
import { pathFor } from "../../app/routes";
import { useServices } from "../../app/services";
import type { Persistence } from "../../storage/persistence";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { StatusBanner } from "../components/StatusBanner";
import { AiProviderCard } from "./settings/AiProvider";
import { StatusSummary } from "./settings/StatusSummary";

/**
 * What Settings says about whether the browser will keep the data saved on
 * this device (PRD AC-28). Each line is what the browser reported, said
 * plainly: none promises more than the browser did.
 */
export const STORAGE_KEPT: Record<Persistence, string> = {
  persistent:
    "This browser has agreed to keep what Warmly saves on this device. It won't clear it to make room for other things.",
  "best-effort":
    "This browser may clear what Warmly saves on this device if the device runs short of space, or if Warmly isn't opened for a long time. Opening Warmly often, or adding it to your home screen, makes that less likely.",
  unsupported:
    "This browser doesn't say whether it will keep what Warmly saves on this device, so it may clear it if the device runs short of space.",
};

/**
 * Account settings. For now it covers the recovery key, the account key's
 * fingerprint and whether the browser will keep this device's data; the
 * remaining settings arrive with their own issues.
 *
 * @returns The settings screen.
 */
export function Settings(): JSX.Element {
  const { vault, persistence } = useServices();
  const [fingerprint, setFingerprint] = useState<string | undefined>(undefined);
  const [kept, setKept] = useState<Persistence | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void persistence.state().then((state) => {
      if (!cancelled) {
        setKept(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [persistence]);

  useEffect(() => {
    let cancelled = false;
    vault.fingerprint().then(
      (value) => {
        if (!cancelled) {
          setFingerprint(value);
        }
      },
      // The fingerprint is a convenience. If it cannot be worked out, the
      // card below is simply not shown.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [vault]);

  return (
    <PageLayout title="Settings" lead="Your account and your recovery key.">
      <StatusSummary />
      <Card heading="Recovery key">
        <p>
          Your recovery key opens your journal on a new device. If you think
          someone else has seen it, replace it. You'll need the current key to
          do that. Replacing it stops the old key working from now on. It cannot
          undo anything already copied by someone who had the old key and access
          to our servers.
        </p>
        <p>
          <Link href={pathFor("rotate-recovery-key")}>
            Replace your recovery key
          </Link>
        </p>
      </Card>
      {fingerprint !== undefined && (
        <Card heading="Account key fingerprint">
          <p class="recovery-key" data-testid="key-fingerprint">
            {fingerprint}
          </p>
          <p>
            Every device signed in to your account and unlocked shows the same
            fingerprint. It is a label for comparing devices. It is not a secret
            and cannot open anything.
          </p>
        </Card>
      )}
      <AiProviderCard />
      {kept !== undefined && (
        <Card heading="Storage on this device">
          <p data-testid="storage-persistence">{STORAGE_KEPT[kept]}</p>
          <p>
            What you write is encrypted before it is saved here. Clearing this
            browser's site data for Warmly removes what is saved on this device.
          </p>
        </Card>
      )}
      <StatusBanner tone="info" label="Coming soon">
        More settings are not built yet.
      </StatusBanner>
    </PageLayout>
  );
}
