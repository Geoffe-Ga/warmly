/**
 * Path matching for the route table. Pure functions with no DOM access, so the
 * same logic is trivially unit-testable.
 */
import { OPAQUE_ID, ROUTES, type RouteDef, type RouteParams } from "./routes";

/** The route a path resolved to, with its extracted parameters. */
export interface RouteMatch {
  readonly route: RouteDef;
  readonly params: RouteParams;
}

/**
 * Normalise a pathname so `/journal/` and `/journal` are the same place.
 *
 * @param pathname - A URL pathname, possibly empty or with trailing slashes.
 * @returns The pathname without trailing slashes; the root is `/`.
 */
export function normalisePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function segmentsOf(path: string): readonly string[] {
  return normalisePath(path).split("/").slice(1);
}

function matchSegments(
  pattern: readonly string[],
  actual: readonly string[],
): RouteParams | undefined {
  if (pattern.length !== actual.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const [index, expected] of pattern.entries()) {
    const value = actual[index] ?? "";
    if (!expected.startsWith(":")) {
      if (expected !== value) {
        return undefined;
      }
    } else if (OPAQUE_ID.test(value)) {
      params[expected.slice(1)] = value;
    } else {
      return undefined;
    }
  }
  return params;
}

/**
 * Find the route for a pathname.
 *
 * Static segments win over parameters because the table is checked in order of
 * fewest parameters first. A parameter only matches an opaque record ID.
 *
 * @param pathname - The URL pathname to resolve.
 * @returns The matching route and its parameters, or `undefined` if none.
 */
export function matchRoute(pathname: string): RouteMatch | undefined {
  const actual = segmentsOf(pathname);
  const bySpecificity = [...ROUTES].sort(
    (a, b) => parameterCount(a) - parameterCount(b),
  );
  for (const route of bySpecificity) {
    const params = matchSegments(segmentsOf(route.path), actual);
    if (params) {
      return { route, params };
    }
  }
  return undefined;
}

function parameterCount(route: RouteDef): number {
  return segmentsOf(route.path).filter((segment) => segment.startsWith(":"))
    .length;
}
