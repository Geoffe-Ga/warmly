import type { JSX } from "preact";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { Card } from "../../components/Card";
import { PageLayout } from "../../components/PageLayout";

/**
 * Shown on a device after it has been revoked (PRD DEV-003, DEV-004; AC-20).
 * It says what happened and, honestly, what is still on the device. No
 * private content is shown: by the time this screen appears the keys are
 * gone and the session has ended.
 *
 * @returns The screen a revoked device lands on.
 */
export function DeviceRevoked(): JSX.Element {
  return (
    <PageLayout
      title="This device was removed"
      lead="It was removed from your account, here or on another of your devices, so it has been signed out."
    >
      <Card heading="What this means">
        <p>
          This device can no longer sync, and it can no longer open your
          journal. Its keys have been deleted from this browser.
        </p>
        <p>
          Anything it had already saved is still stored in this browser,
          encrypted. Nothing was erased, and nothing here can read it any more.
          To remove it completely, clear this site's data in your browser
          settings.
        </p>
      </Card>
      <Card heading="If you still use this device">
        <p>
          Sign in again and add it back, with your recovery key or from another
          of your devices. It will join as a new device.
        </p>
        <p>
          <Link href={pathFor("sign-in")}>Sign in</Link>
        </p>
      </Card>
      <Card heading="If you didn't do this">
        <p>
          Someone who can sign in to your account and enter your password
          removed this device. Change your password, then replace your recovery
          key from a device you trust.
        </p>
      </Card>
    </PageLayout>
  );
}
