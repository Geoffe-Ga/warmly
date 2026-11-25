/**
 * Application shell (ADR-0001): owns the current path, applies the access
 * rules for the session state, and wraps the screen in the shared header and
 * `<main>` landmark.
 */
import type { JSX } from "preact";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "preact/hooks";

import { Button } from "../ui/components/Button";
import { PAGE_HEADING_ATTRIBUTE } from "../ui/components/PageHeading";
import { PageLayout } from "../ui/components/PageLayout";
import { SyncStatus } from "../ui/components/SyncStatus";
import {
  SessionControls,
  endRevokedDevice,
  useInactivityLock,
} from "./SessionControls";
import { Link, NavigationContext, type Navigation } from "./navigation";
import { useOnline } from "./online";
import { APP_NAME, resolve } from "./resolve";
import { normalisePath } from "./router";
import { SECONDARY_NAV } from "./routes";
import {
  ServicesProvider,
  createServices,
  useServices,
  type Services,
} from "./services";
import type { SessionState } from "./session";
import { useSessionState } from "./use-session-state";

function currentPath(): string {
  return normalisePath(window.location.pathname);
}

function Header(props: {
  readonly showHomeLink: boolean;
  readonly state: SessionState;
  readonly navigate: (path: string) => void;
}): JSX.Element {
  const { sync } = useServices();
  const unlocked = props.state === "unlocked";
  return (
    <header class="app-header">
      {props.showHomeLink && unlocked && (
        <Link href="/" label="Warmly home" class="home-link">
          {APP_NAME}
        </Link>
      )}
      {!unlocked && <span class="app-name">{APP_NAME}</span>}
      {unlocked && (
        <nav aria-label="Secondary">
          <ul class="secondary-nav">
            {SECONDARY_NAV.map((item) => (
              <li key={item.label}>
                <Link href={item.path}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <SessionControls navigate={props.navigate} />
      {unlocked && <SyncStatus sync={sync} />}
    </header>
  );
}

/** Props for {@link App}. */
export interface AppProps {
  /** Services to use; a test passes its own. Defaults to this build's. */
  readonly services?: Services;
}

/** Said while offline and unlocked. It never shows anything private. */
export const OFFLINE_UNLOCKED =
  "Offline: your writing is saved on this device.";
/** Said while offline and not unlocked. */
export const OFFLINE_LOCKED =
  "Offline: you can still unlock Warmly on a device you have set up. Signing in needs a connection.";

/**
 * A line under the header while the device is offline (PRD UI-008, AC-28).
 * The region is always in the page, empty while online, so a screen reader
 * hears the change when the connection drops.
 */
function OfflineNotice(props: { readonly state: SessionState }): JSX.Element {
  const online = useOnline();
  let text = "";
  if (!online) {
    text = props.state === "unlocked" ? OFFLINE_UNLOCKED : OFFLINE_LOCKED;
  }
  return (
    <p role="status" class="offline-notice">
      {text}
    </p>
  );
}

/** Said when unsaved writing could not be saved before an update. */
export const UPDATE_NOT_APPLIED =
  "Couldn't save what you're writing, so Warmly was not updated. Nothing was lost. Try again in a moment.";

/**
 * Says when a new version of the app is ready and lets the person switch to
 * it (PRD §8, REL-004; AC-28).
 *
 * A new version is never switched to on its own: the page reloads, and
 * that must not happen under something half written. When the person asks,
 * unsaved writing is saved first; if that fails, the update is not applied
 * and they are told. The text is fixed and says nothing private.
 */
function UpdateNotice(): JSX.Element {
  const { updates, lockHooks } = useServices();
  const [ready, setReady] = useState(() => updates.available());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    const update = (): void => {
      setReady(updates.available());
    };
    update();
    return updates.subscribe(update);
  }, [updates]);

  const apply = (): void => {
    setBusy(true);
    setProblem(false);
    void lockHooks
      .flush()
      .then(async (unsaved) => {
        if (unsaved > 0) {
          setProblem(true);
          return;
        }
        await updates.apply();
      })
      .catch(() => {
        setProblem(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div class="update-notice">
      <p role="status">
        {ready && !problem ? "A new version of Warmly is ready." : ""}
        {ready && problem ? UPDATE_NOT_APPLIED : ""}
      </p>
      {ready && (
        <Button disabled={busy} onClick={apply}>
          Update now
        </Button>
      )}
    </div>
  );
}

/**
 * Root component. Restores the signed-in session, owns the current path and
 * keeps it in step with the browser history, enforces the access rules, sets
 * the document title, and moves focus to the page heading after each in-app
 * navigation.
 *
 * @param props - See {@link AppProps}.
 * @returns The whole application.
 */
export function App(props: AppProps): JSX.Element {
  const services = useMemo(
    () => props.services ?? createServices(),
    [props.services],
  );
  const { state, ready } = useSessionState(services);
  const [path, setPath] = useState(currentPath);
  // Counts in-app navigations. Zero means first render: focus is left alone.
  const [navigations, setNavigations] = useState(0);

  const navigate = useCallback((target: string): void => {
    const next = normalisePath(target);
    if (next !== currentPath()) {
      window.history.pushState(null, "", next);
    }
    setPath(next);
    setNavigations((count) => count + 1);
  }, []);

  useEffect(() => {
    const onPopState = (): void => {
      setPath(currentPath());
      setNavigations((count) => count + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useInactivityLock(services, state, navigate);

  // The server can refuse this device as revoked on any request.
  useEffect(
    () =>
      services.revocation.subscribe(() => {
        void endRevokedDevice(services, navigate);
      }),
    [services, navigate],
  );

  const resolution = useMemo(() => resolve(path, state), [path, state]);

  // A redirect replaces the history entry, so Back does not return to a
  // screen the session may not see.
  useEffect(() => {
    if (ready && resolution.kind === "redirect") {
      window.history.replaceState(null, "", resolution.to);
      setPath(resolution.to);
      setNavigations((count) => count + 1);
    }
  }, [ready, resolution]);

  const view =
    ready && resolution.kind === "view" ? resolution.view : undefined;

  useEffect(() => {
    if (view !== undefined) {
      document.title = view.isHome ? APP_NAME : `${view.title} · ${APP_NAME}`;
    }
  }, [view]);

  // A layout effect, so focus moves in the same step as the screen change.
  // A deferred effect would leave a moment in which the new screen is visible
  // and usable but focus has not moved yet, and input started in that moment
  // would be interrupted when focus jumped to the heading.
  useLayoutEffect(() => {
    if (navigations > 0 && view !== undefined) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [navigations, view]);

  const navigation = useMemo<Navigation>(
    () => ({ path, navigate }),
    [path, navigate],
  );

  return (
    <ServicesProvider value={services}>
      <NavigationContext.Provider value={navigation}>
        <div class="shell">
          <Header
            showHomeLink={view?.isHome !== true}
            state={state}
            navigate={navigate}
          />
          <OfflineNotice state={state} />
          <UpdateNotice />
          <main>
            {view === undefined ? (
              <PageLayout title="Opening Warmly" />
            ) : (
              view.render()
            )}
          </main>
        </div>
      </NavigationContext.Provider>
    </ServicesProvider>
  );
}
