/**
 * Application shell (ADR-0001): resolves the current path to a screen, applies
 * the access rules for the session state, and wraps the screen in the shared
 * header and `<main>` landmark.
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
import { GALLERY_PATH, Gallery } from "../ui/dev/Gallery";
import { Home } from "../ui/screens/Home";
import { NotFound } from "../ui/screens/NotFound";
import { Placeholder } from "../ui/screens/Placeholder";
import { Locked } from "../ui/screens/account/Locked";
import { Recover } from "../ui/screens/account/Recover";
import { RecoveryKey } from "../ui/screens/account/RecoveryKey";
import { Register } from "../ui/screens/account/Register";
import { ResetPassword } from "../ui/screens/account/ResetPassword";
import { SignIn } from "../ui/screens/account/SignIn";
import { VerifyEmail } from "../ui/screens/account/VerifyEmail";
import { LOCKED_PATH, SIGN_IN_PATH, redirectFor } from "./access";
import { Link, NavigationContext, type Navigation } from "./navigation";
import { matchRoute, normalisePath } from "./router";
import { SECONDARY_NAV, type RouteDef, type RouteId } from "./routes";
import {
  ServicesProvider,
  createServices,
  useServices,
  type Services,
} from "./services";
import type { SessionState } from "./session";

const APP_NAME = "Warmly";

/** What to show for a path: its title and the screen to render. */
interface View {
  readonly title: string;
  readonly isHome: boolean;
  readonly render: () => JSX.Element;
}

/** Screens that have been built. Every other route shows a placeholder. */
const SCREENS: Readonly<Partial<Record<RouteId, () => JSX.Element>>> = {
  home: Home,
  onboarding: Register,
  "verify-email": VerifyEmail,
  "recovery-key": RecoveryKey,
  "sign-in": SignIn,
  "reset-password": ResetPassword,
  recover: Recover,
  locked: Locked,
};

function currentPath(): string {
  return normalisePath(window.location.pathname);
}

function viewForRoute(route: RouteDef): View {
  const Screen = SCREENS[route.id];
  return {
    title: route.id === "home" ? APP_NAME : route.title,
    isHome: route.id === "home",
    render: () =>
      Screen === undefined ? <Placeholder route={route} /> : <Screen />,
  };
}

/**
 * Screens that exist for development and testing only. The build mode is a
 * compile-time constant, so in a production build this condition is `false`
 * and the bundler drops the branch and the gallery with it. They are present
 * in development, in unit tests and in the `e2e` build.
 *
 * @param path - A normalised pathname.
 * @returns The development view for that path, if there is one.
 */
function resolveDevView(path: string): View | undefined {
  if (import.meta.env.MODE !== "production" && path === GALLERY_PATH) {
    return {
      title: "Component gallery",
      isHome: false,
      render: () => <Gallery />,
    };
  }
  return undefined;
}

/** The outcome of resolving a path: a screen to show, or somewhere else to go. */
export type Resolution =
  | { readonly kind: "view"; readonly view: View }
  | { readonly kind: "redirect"; readonly to: string };

/**
 * Decide what a path shows for the current session state.
 *
 * A route the session may not see resolves to a redirect, never to a view, so
 * a private screen cannot be rendered while signed out or locked (PRD
 * DEV-005). Paths that match no route carry no private content and resolve to
 * a view in every state.
 *
 * @param path - A normalised pathname.
 * @param state - The current session state.
 * @returns A view, or the path to go to instead.
 */
export function resolve(path: string, state: SessionState): Resolution {
  const match = matchRoute(path);
  if (match) {
    const to = redirectFor(match.route.access, state);
    return to === undefined
      ? { kind: "view", view: viewForRoute(match.route) }
      : { kind: "redirect", to };
  }
  return {
    kind: "view",
    view: resolveDevView(path) ?? {
      title: "Page not found",
      isHome: false,
      render: () => <NotFound />,
    },
  };
}

function SessionControls(props: {
  readonly navigate: (path: string) => void;
}): JSX.Element | null {
  const { auth, vault, session } = useServices();
  if (session.state === "signed_out") {
    return null;
  }
  const signOut = (): void => {
    const finishLocally = (): void => {
      vault.lock();
      session.signOut();
      props.navigate(SIGN_IN_PATH);
    };
    // Signing out on this device must always succeed. If the server cannot be
    // told, for example while offline, the keys are still dropped and the
    // private screens still close.
    auth.signOut().then(finishLocally, finishLocally);
  };
  const lock = (): void => {
    vault.lock();
    session.lock();
    props.navigate(LOCKED_PATH);
  };
  return (
    <div class="button-row">
      {session.state === "unlocked" && <Button onClick={lock}>Lock</Button>}
      <Button onClick={signOut}>Sign out</Button>
    </div>
  );
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
  const { auth, session } = services;
  const [state, setState] = useState(session.state);
  const [ready, setReady] = useState(false);
  const [path, setPath] = useState(currentPath);
  // Counts in-app navigations. Zero means first render: focus is left alone.
  const [navigations, setNavigations] = useState(0);

  useEffect(() => session.subscribe(setState), [session]);

  // A reload keeps the user signed in but never unlocked: keys live in memory.
  useEffect(() => {
    let cancelled = false;
    void auth
      .isSignedIn()
      .then((signedIn) => {
        if (!cancelled && signedIn && session.state === "signed_out") {
          session.signIn();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth, session]);

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
