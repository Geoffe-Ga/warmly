import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../app/navigation";
import { pathFor } from "../../app/routes";
import { useServices } from "../../app/services";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { StatusBanner } from "../components/StatusBanner";

/**
 * Account settings. For now it covers the recovery key and shows the account
 * key's fingerprint; the remaining settings arrive with their own issues.
 *
 * @returns The settings screen.
 */
export function Settings(): JSX.Element {
  const { vault } = useServices();
  const [fingerprint, setFingerprint] = useState<string | undefined>(undefined);

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
      <Card heading="Recovery key">
        <p>
          Your recovery key opens your journal on a new device. If you think
          someone else has seen it, replace it. You'll need the current key to
          do that.
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
      <StatusBanner tone="info" label="Coming soon">
        More settings are not built yet.
      </StatusBanner>
    </PageLayout>
  );
}
