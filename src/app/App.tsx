/**
 * Application shell (ADR-0001): resolves the current path to a screen and
 * wraps it in the shared header, secondary navigation and `<main>` landmark.
 */
import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import { PAGE_HEADING_ATTRIBUTE } from "../ui/components/PageHeading";
import { GALLERY_PATH, Gallery } from "../ui/dev/Gallery";
import { Home } from "../ui/screens/Home";
import { NotFound } from "../ui/screens/NotFound";
import { Placeholder } from "../ui/screens/Placeholder";
import { Link, NavigationContext, type Navigation } from "./navigation";
import { matchRoute, normalisePath } from "./router";
import { SECONDARY_NAV } from "./routes";

const APP_NAME = "Warmly";

/** What to show for a path: its title and the screen to render. */
interface View {
  readonly title: string;
  readonly isHome: boolean;
  readonly render: () => JSX.Element;
}

function currentPath(): string {
  return normalisePath(window.location.pathname);
}

/**
 * Development-only screens. `import.meta.env.DEV` is replaced with `false` in
 * a production build, so the bundler drops this branch and the gallery with it.
 *
 * @param path - A normalised pathname.
 * @returns The development view for that path, if there is one.
 */
function resolveDevView(path: string): View | undefined {
  if (import.meta.env.DEV && path === GALLERY_PATH) {
    return {
      title: "Component gallery",
      isHome: false,
      render: () => <Gallery />,
    };
  }
  return undefined;
}

/**
 * Decide what a path shows.
 *
 * @param path - A normalised pathname.
 * @returns The view for that path.
 */
export function resolveView(path: string): View {
  const match = matchRoute(path);
  if (match?.route.id === "home") {
    return { title: APP_NAME, isHome: true, render: () => <Home /> };
  }
  if (match) {
    return {
      title: match.route.title,
      isHome: false,
      render: () => <Placeholder route={match.route} />,
    };
  }
  return (
    resolveDevView(path) ?? {
      title: "Page not found",
      isHome: false,
      render: () => <NotFound />,
    }
  );
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
 * each in-app navigation, including a click on the link to the current screen.
 *
 * @returns The whole application.
 */
export function App(): JSX.Element {
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

  const view = useMemo(() => resolveView(path), [path]);

  useEffect(() => {
    document.title = view.isHome ? APP_NAME : `${view.title} · ${APP_NAME}`;
  }, [view]);

  useEffect(() => {
    if (navigations > 0) {
      document
        .querySelector<HTMLElement>(`[${PAGE_HEADING_ATTRIBUTE}]`)
        ?.focus();
    }
  }, [navigations]);

  const navigation = useMemo<Navigation>(
    () => ({ path, navigate }),
    [path, navigate],
  );

  return (
    <NavigationContext.Provider value={navigation}>
      <div class="shell">
        <Header showHomeLink={!view.isHome} />
        <main>{view.render()}</main>
      </div>
    </NavigationContext.Provider>
  );
}
