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

import { PAGE_HEADING_ATTRIBUTE } from "../ui/components/PageHeading";
import { PageLayout } from "../ui/components/PageLayout";
import { SessionControls } from "./SessionControls";
import { Link, NavigationContext, type Navigation } from "./navigation";
import { APP_NAME, resolve } from "./resolve";
import { normalisePath } from "./router";
import { SECONDARY_NAV } from "./routes";
import { ServicesProvider, createServices, type Services } from "./services";
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
    </header>
  );
}

/** Props for {@link App}. */
export interface AppProps {
  /** Services to use; a test passes its own. Defaults to this build's. */
  readonly services?: Services;
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
