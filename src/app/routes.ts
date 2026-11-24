/**
 * The single route table for Warmly (ADR-0001).
 *
 * This module is plain data with no UI imports, so the router, the screens and
 * the Playwright accessibility sweep can all read the same list.
 *
 * Privacy rule (PRD SEC-007): a URL may carry opaque record IDs only. Journal
 * text, search queries and card text must never be placed in a path or query
 * string, so parameters are restricted to {@link OPAQUE_ID}.
 */

/** Identifier of every screen in the MVP. */
export type RouteId =
  | "home"
  | "journal"
  | "journal-new"
  | "journal-entry"
  | "reflect"
  | "reflect-session"
  | "prepare"
  | "collection"
  | "card"
  | "present"
  | "print"
  | "settings"
  | "devices"
  | "onboarding"
  | "sign-in"
  | "locked";

/** One entry in the route table. */
export interface RouteDef {
  /** Stable identifier used to look up the screen component. */
  readonly id: RouteId;
  /** Path pattern. Segments starting with `:` are opaque-ID parameters. */
  readonly path: string;
  /** Screen title: shown as the page heading and in the document title. */
  readonly title: string;
  /** One sentence describing what the finished screen will do. */
  readonly summary: string;
}

/** A navigation link: a visible label and the path it leads to. */
export interface NavItem {
  readonly label: string;
  readonly path: string;
}

/** Values substituted into the `:name` segments of a route path. */
export type RouteParams = Readonly<Record<string, string>>;

/** What a path parameter may look like: an opaque record ID, never user text. */
export const OPAQUE_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Every MVP screen, in the order the product presents them. */
export const ROUTES: readonly RouteDef[] = [
  {
    id: "home",
    path: "/",
    title: "Warmly",
    summary: "Your private journal and conversation aid.",
  },
  {
    id: "journal",
    path: "/journal",
    title: "Journal",
    summary: "Your entries in date order, with search.",
  },
  {
    id: "journal-new",
    path: "/journal/new",
    title: "New journal entry",
    summary: "Three questions to answer in your own words.",
  },
  {
    id: "journal-entry",
    path: "/journal/entries/:id",
    title: "Journal entry",
    summary: "One entry, which you can read, edit or delete.",
  },
  {
    id: "reflect",
    path: "/reflect",
    title: "Reflect",
    summary: "Ask your own question about your own journal.",
  },
  {
    id: "reflect-session",
    path: "/reflect/sessions/:id",
    title: "Reflection",
    summary: "One private conversation about your journal.",
  },
  {
    id: "prepare",
    path: "/prepare",
    title: "Prepare for a Conversation",
    summary: "Your private collections of conversation cards.",
  },
  {
    id: "collection",
    path: "/prepare/collections/:id",
    title: "Collection",
    summary: "The cards in one collection, in the order you chose.",
  },
  {
    id: "card",
    path: "/prepare/collections/:id/cards/:cardId",
    title: "Card",
    summary: "One conversation card, which you can rewrite freely.",
  },
  {
    id: "present",
    path: "/prepare/collections/:id/present",
    title: "Presentation",
    summary: "One card at a time, in large text.",
  },
  {
    id: "print",
    path: "/prepare/collections/:id/print",
    title: "Print",
    summary: "A clean printable copy of one collection.",
  },
  {
    id: "settings",
    path: "/settings",
    title: "Settings",
    summary: "Your account, AI provider and privacy settings.",
  },
  {
    id: "devices",
    path: "/settings/devices",
    title: "Manage Devices",
    summary: "The devices that can open your journal.",
  },
  {
    id: "onboarding",
    path: "/welcome",
    title: "Welcome to Warmly",
    summary: "Create your account and save your recovery key.",
  },
  {
    id: "sign-in",
    path: "/sign-in",
    title: "Sign in",
    summary: "Sign in to your own account.",
  },
  {
    id: "locked",
    path: "/locked",
    title: "Warmly is locked",
    summary: "Unlock to see your journal.",
  },
];

/** The three primary Home actions, exactly as PRD UX-001 specifies. */
export const PRIMARY_ACTIONS: readonly NavItem[] = [
  { label: "Journal", path: "/journal" },
  { label: "Reflect", path: "/reflect" },
  { label: "Prepare for a Conversation", path: "/prepare" },
];

/** Secondary navigation (PRD UX-001): collections, settings, devices. */
export const SECONDARY_NAV: readonly NavItem[] = [
  { label: "Collections", path: "/prepare" },
  { label: "Settings", path: "/settings" },
  { label: "Manage Devices", path: "/settings/devices" },
];

/**
 * Build the concrete path for a route.
 *
 * @param id - The route to link to.
 * @param params - A value for each `:name` segment in the route's path.
 * @returns The path, ready to use as an `href`.
 * @throws Error if a parameter is missing or is not an opaque ID.
 */
export function pathFor(id: RouteId, params: RouteParams = {}): string {
  const route = ROUTES.find((candidate) => candidate.id === id);
  if (!route) {
    throw new Error(`Unknown route: ${id}`);
  }
  return route.path.replace(/:([A-Za-z]+)/g, (_segment, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing parameter "${name}" for route ${id}`);
    }
    if (!OPAQUE_ID.test(value)) {
      throw new Error(`Parameter "${name}" must be an opaque ID`);
    }
    return value;
  });
}
