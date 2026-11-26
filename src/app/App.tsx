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
import { SECONDARY_NAV, pathFor } from "./routes";
import {
  ServicesProvider,
  createServices,
  useServices,
  type Services,
} from "./services";
import type { SessionState } from "./session";
import {
  UNSUPPORTED_BROWSER,
  cannotKeepWriting,
  missingFeatures,
} from "./support";
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

/**
 * A warning on every screen when this browser cannot encrypt or store
 * (PRD UI-003). Worked out once: what a browser offers does not change
 * while the page is open. Fixed words, and a way to the page that says
 * what Warmly is.
 */
function UnsupportedNotice(): JSX.Element | null {
  const unsupported = useMemo(() => cannotKeepWriting(missingFeatures()), []);
  if (!unsupported) {
    return null;
  }
  return (
    <p role="alert" class="unsupported-notice">
      {UNSUPPORTED_BROWSER}{" "}
      <Link href={pathFor("help")}>What Warmly is and is not</Link>
    </p>
  );
}

/** Said when unsaved writing could not be saved before an update. */
export const UPDATE_NOT_APPLIED =
  "Couldn't save what you're writing, so Warmly was not updated. Nothing was lost. Try again in a moment.";

/** Said when the writing was saved but the new version could not start. */
export const UPDATE_FAILED =
  "Couldn't switch to the new version. Nothing was lost. Try again in a moment.";

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
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    const update = (): void => {
      setReady(updates.available());
    };
    update();
    return updates.subscribe(update);
  }, [updates]);

  const apply = (): void => {
    setBusy(true);
    setProblem(undefined);
    void lockHooks
      .flush()
      .then(
        (unsaved) => unsaved === 0,
        () => false,
      )
      .then(async (saved) => {
        if (!saved) {
          setProblem(UPDATE_NOT_APPLIED);
          return;
        }
        await updates.apply();
      })
      .catch(() => {
        setProblem(UPDATE_FAILED);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div class="update-notice">
      <p role="status">
        {ready ? (problem ?? "A new version of Warmly is ready.") : ""}
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
 * What is said when reflections were removed because a journal entry
 * they were built from was changed or deleted (PRD DEP-003). A count and
 * fixed words: never which reflection, which entry or what either said.
 *
 * @param count - How many were removed, of both kinds.
 * @param cards - How many of them are cards drafted by AI; the rest are
 *   reflections.
 * @returns The sentence.
 */
export function removedText(count: number, cards = 0): string {
  const things = [
    counted(count - cards, "reflection", "reflections"),
    counted(cards, "card drafted by AI", "cards drafted by AI"),
  ].filter((each) => each !== undefined);
  const one = count === 1;
  return `${capitalised(things.join(" and "))} ${one ? "was" : "were"} removed because a journal entry ${one ? "it was" : "they were"} built from was changed or deleted.`;
}

/** "a reflection", "3 reflections", or nothing when there are none. */
function counted(count: number, one: string, many: string): string | undefined {
  if (count <= 0) {
    return undefined;
  }
  return count === 1 ? `a ${one}` : `${count.toLocaleString("en-US")} ${many}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Tells the person when reflections or AI cards have been removed, until they say
 * they have seen it. Removing them calls no AI and nothing is made again.
 */
function RemovedNotice(props: { readonly state: SessionState }): JSX.Element {
  const { invalidation } = useServices();
  const [count, setCount] = useState(() => invalidation.removed);
  const [cards, setCards] = useState(() => invalidation.removedCards);
  const unlocked = props.state === "unlocked";

  useEffect(() => {
    // Anything built from an entry that changed while this device was
    // locked or away is removed on unlock, and after every change from
    // then on. Locking stops it (`dropSecrets`).
    if (unlocked) {
      invalidation.start();
    }
  }, [invalidation, unlocked]);

  useEffect(() => {
    const update = (): void => {
      setCount(invalidation.removed);
      setCards(invalidation.removedCards);
    };
    update();
    return invalidation.subscribe(update);
  }, [invalidation]);

  return (
    <div class="removed-notice">
      <p role="status">{count > 0 ? removedText(count, cards) : ""}</p>
      {count > 0 && (
        <Button
          onClick={() => {
            invalidation.acknowledge();
          }}
        >
          OK
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
          <UnsupportedNotice />
          <OfflineNotice state={state} />
          <UpdateNotice />
          <RemovedNotice state={state} />
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
