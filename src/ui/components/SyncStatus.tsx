import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../app/navigation";
import { pathFor } from "../../app/routes";
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
    case "outdated":
      return "Update Warmly to keep syncing. Your writing is saved on this device.";
  }
}

/** Follow the sync engine's state. */
function useSyncState(sync: SyncControl): SyncState {
  const [state, setState] = useState(() => sync.state());
  useEffect(() => {
    const update = (): void => {
      setState(sync.state());
    };
    const unsubscribe = sync.subscribe(update);
    update();
    return unsubscribe;
  }, [sync]);
  return state;
}

/**
 * The sync status line (PRD SYNC-010, AC-23): a state and a count, said
 * politely when it changes. When a record needs the person, a link leads
 * to where they can see why. It sits in the top bar while unlocked.
 *
 * @param props - The sync engine.
 * @returns The line.
 */
export function SyncStatus(props: { readonly sync: SyncControl }): JSX.Element {
  const state = useSyncState(props.sync);
  return (
    <div class="sync-status">
      <p role="status" aria-live="polite">
        {describeSync(state)}
      </p>
      {state.status === "attention" && (
        <Link href={pathFor("sync-conflicts")}>Review what changed</Link>
      )}
    </div>
  );
}

/**
 * The button that runs a sync now. Sync also runs on its own; this is for
 * the person who wants it at once. It lives in the menu.
 *
 * @param props - The sync engine.
 * @returns The button.
 */
export function SyncNow(props: { readonly sync: SyncControl }): JSX.Element {
  const { sync } = props;
  const [busy, setBusy] = useState(false);
  return (
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
  );
}
