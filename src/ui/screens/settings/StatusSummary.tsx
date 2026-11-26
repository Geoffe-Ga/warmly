import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { useOnline } from "../../../app/online";
import { useServices } from "../../../app/services";
import { Card } from "../../components/Card";
import { describeSync } from "../../components/SyncStatus";

/** What the summary covers, in the order shown (PRD UI-008). */
export const STATUS_ITEMS = [
  "Encryption",
  "Connection",
  "Sync",
  "AI provider",
  "Recovery key",
  "Devices",
  "Deleting",
] as const;

/** Said of encryption. It must stay true: it promises no more than is done. */
export const ENCRYPTION_STATUS =
  "On. What you write is encrypted on this device before it is saved or synced, so Warmly's servers cannot read it. It is readable on this device while Warmly is unlocked, and by an AI provider only when you choose to send it.";

/** Said when no AI provider is connected. */
export const NO_PROVIDER_STATUS =
  "None connected. Nothing can be sent to an AI provider.";

/** Said of the recovery key. */
export const RECOVERY_STATUS =
  "Set when this account's keys were made. It opens your journal on a new device, so keep it somewhere safe. You can replace it below.";

/** Said of devices. */
export const DEVICES_STATUS =
  "A device you remove stops syncing straight away and is signed out the next time it connects. Removing it cannot erase what that device already holds. See Manage Devices, in the menu at the top.";

/**
 * Said of deleting. It says the same as the warning shown before each
 * deletion (`DELETE_WARNING`), and a test keeps the two in step.
 */
export const DELETING_STATUS =
  "Deleting is for good. There is no trash and no undo. What you delete goes from this device at once, and from your other devices the next time they sync. Encrypted copies held in backups cannot be read by anyone but you, and are removed as those backups expire, within 30 days.";

/**
 * Where everything that protects the person's writing stands, in one
 * place (PRD UI-008): encryption, the connection, sync, the AI provider,
 * the recovery key, devices and deleting.
 *
 * Every line is a state, a count or fixed words. None holds anything the
 * person wrote, and none claims more than the app does. The screen is
 * private, so none of it is shown while the app is locked.
 *
 * @returns The card.
 */
export function StatusSummary(): JSX.Element {
  const { ai, sync } = useServices();
  const online = useOnline();
  const [syncState, setSyncState] = useState(() => sync.state());
  useEffect(() => {
    const update = (): void => {
      setSyncState(sync.state());
    };
    const stop = sync.subscribe(update);
    update();
    return stop;
  }, [sync]);

  const provider = ai.state();
  const syncText = describeSync(syncState);
  const values: Readonly<Record<(typeof STATUS_ITEMS)[number], JSX.Element>> = {
    Encryption: <>{ENCRYPTION_STATUS}</>,
    Connection: (
      <>
        {online
          ? "Online."
          : "Offline. Your writing is saved on this device and is sent when the connection returns."}
      </>
    ),
    // While offline with nothing waiting, the sync line itself is empty.
    Sync: <>{syncText === "" ? "Nothing is waiting to be sent." : syncText}</>,
    "AI provider": (
      <>
        {provider.kind === "none"
          ? NO_PROVIDER_STATUS
          : `${provider.name} is connected. Nothing is sent to it unless you ask, and you are shown what would be sent each time.`}
      </>
    ),
    // The ways to act on these two are already on this page: the recovery
    // key card below, and Manage Devices in the menu above.
    "Recovery key": <>{RECOVERY_STATUS}</>,
    Devices: <>{DEVICES_STATUS}</>,
    Deleting: <>{DELETING_STATUS}</>,
  };

  return (
    <section aria-label="Privacy and status">
      <Card heading="Privacy and status">
        <dl class="status-list">
          {STATUS_ITEMS.map((label) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{values[label]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}
