import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { SyncControl, SyncState } from "../../sync/engine";
import { Button } from "./Button";

/**
 * Put the sync state into words. The text is a state and a count only: it
 * never contains anything a record says (PRD SYNC-010).
 *
 * @param state - Where sync stands.
 * @returns The words to show. Empty while offline with nothing waiting,
 *   where the offline notice already says what matters.
 */
export function describeSync(state: SyncState): string {
  const waiting =
    state.waiting === 1
      ? "1 change waiting to sync"
      : `${String(state.waiting)} changes waiting to sync`;
  switch (state.status) {
    case "synced":
      return "All changes saved";
    case "attention":
      return "Needs your attention";
    case "pending":
      return waiting;
    case "offline":
      return state.waiting > 0 ? waiting : "";
    case "failed":
      return "Couldn't sync. Your writing is saved on this device.";
  }
}

/**
 * The sync status line and the button that runs a sync (PRD SYNC-010,
 * AC-23). The status is announced politely when it changes. Sync also runs
 * on its own; the button is for the person who wants it now.
 *
 * @param props - The sync engine.
 * @returns The indicator.
 */
export function SyncStatus(props: { readonly sync: SyncControl }): JSX.Element {
  const { sync } = props;
  const [state, setState] = useState(() => sync.state());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const update = (): void => {
      setState(sync.state());
    };
    const unsubscribe = sync.subscribe(update);
    update();
    return unsubscribe;
  }, [sync]);

  return (
    <div class="sync-status">
      <p role="status" aria-live="polite">
        {describeSync(state)}
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void sync.sync().finally(() => {
            setBusy(false);
          });
        }}
      >
        Sync now
      </Button>
    </div>
  );
}
