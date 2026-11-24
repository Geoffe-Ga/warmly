/**
 * Application shell (ADR-0001): resolves the current path to a screen and
 * wraps it in the shared header, secondary navigation and `<main>` landmark.
 */
import type { JSX } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import { PAGE_HEADING_ATTRIBUTE } from "../ui/components/PageHeading";
import { Home } from "../ui/screens/Home";
import { NotFound } from "../ui/screens/NotFound";
import { Placeholder } from "../ui/screens/Placeholder";
import { Link, NavigationContext, type Navigation } from "./navigation";
import { matchRoute, normalisePath, type RouteMatch } from "./router";
import { SECONDARY_NAV } from "./routes";

const APP_NAME = "Warmly";

function currentPath(): string {
  return normalisePath(window.location.pathname);
}

function documentTitle(match: RouteMatch | undefined): string {
  if (!match) {
    return `Page not found · ${APP_NAME}`;
  }
  return match.route.id === "home"
    ? APP_NAME
    : `${match.route.title} · ${APP_NAME}`;
}

function Screen(props: {
  readonly match: RouteMatch | undefined;
}): JSX.Element {
  if (!props.match) {
    return <NotFound />;
  }
  if (props.match.route.id === "home") {
    return <Home />;
  }
  return <Placeholder route={props.match.route} />;
}

function Header(props: { readonly showHomeLink: boolean }): JSX.Element {
  return (
    <header class="app-header">
      {props.showHomeLink && (
        <Link href="/" label="Warmly home" class="home-link">
          {APP_NAME}
        </Link>
      )}
      <nav aria-label="Secondary">
        <ul class="secondary-nav">
          {SECONDARY_NAV.map((item) => (
            <li key={item.label}>
              <Link href={item.path}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * Root component. Owns the current path, keeps it in step with the browser
 * history, sets the document title, and moves focus to the page heading after
 * each in-app navigation.
 *
 * @returns The whole application.
 */
export function App(): JSX.Element {
  const [path, setPath] = useState(currentPath);
  const hasNavigated = useRef(false);

  const navigate = useCallback((target: string): void => {
    const next = normalisePath(target);
    if (next !== currentPath()) {
      window.history.pushState(null, "", next);
    }
    hasNavigated.current = true;
    setPath(next);
  }, []);

  useEffect(() => {
    const onPopState = (): void => {
      hasNavigated.current = true;
      setPath(currentPath());
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const match = useMemo(() => matchRoute(path), [path]);

  useEffect(() => {
    document.title = documentTitle(match);
    if (hasNavigated.current) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [match]);

  const navigation = useMemo<Navigation>(
    () => ({ path, navigate }),
    [path, navigate],
  );

  return (
    <NavigationContext.Provider value={navigation}>
      <div class="shell">
        <Header showHomeLink={match?.route.id !== "home"} />
        <main>
          <Screen match={match} />
        </main>
      </div>
    </NavigationContext.Provider>
  );
}
