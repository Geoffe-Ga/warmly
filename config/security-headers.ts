/**
 * The frontend's security headers: one definition used by the preview server,
 * the build (which also embeds the policy as a `<meta>` tag) and the E2E tests.
 * The production host configuration must send exactly these headers.
 *
 * PRD §4.2 [SEC-007]: strong CSP, XSS prevention and security headers.
 */

/** Origins the app may connect to besides its own. */
export interface ConnectSources {
  /** Origin of the Warmly API, when it is not served from the app's origin. */
  readonly apiOrigin?: string;
  /** Origin of the Supabase Auth endpoint. */
  readonly authOrigin?: string;
}

const SELF = "'self'";
const NONE = "'none'";

// An exact https origin: scheme, a literal host name, an optional port. No
// path, no wildcard and no CSP keyword can match.
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

function isOrigin(value: string): boolean {
  return HTTPS_ORIGIN.test(value);
}

/**
 * Build the Content Security Policy directives.
 *
 * Everything is denied by default. Scripts and styles load from the app's own
 * origin only, with no inline code and no `eval`. `connect-src` is an explicit
 * allowlist: AI provider hosts are deliberately absent until the AI gateway
 * issue adds them.
 *
 * @param sources - Extra origins the app must reach.
 * @returns Directive names mapped to their source lists, in a stable order.
 * @throws Error if a source is not a bare `https://` origin.
 */
export function cspDirectives(
  sources: ConnectSources = {},
): ReadonlyMap<string, readonly string[]> {
  const extra = [sources.apiOrigin, sources.authOrigin].filter(
    (origin) => origin !== undefined,
  );
  for (const origin of extra) {
    if (!isOrigin(origin)) {
      throw new Error(`connect-src entries must be https origins: ${origin}`);
    }
  }
  return new Map<string, readonly string[]>([
    ["default-src", [NONE]],
    ["script-src", [SELF]],
    ["style-src", [SELF]],
    ["img-src", [SELF]],
    ["font-src", [SELF]],
    ["manifest-src", [SELF]],
    ["worker-src", [SELF]],
    ["connect-src", [SELF, ...extra]],
    ["form-action", [SELF]],
    ["base-uri", [NONE]],
    ["frame-ancestors", [NONE]],
  ]);
}

/** Directives a `<meta>` policy cannot express; browsers ignore them there. */
const HEADER_ONLY_DIRECTIVES = new Set(["frame-ancestors"]);

function serialise(directives: Iterable<[string, readonly string[]]>): string {
  return [...directives]
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/**
 * The policy as an HTTP header value.
 *
 * @param sources - Extra origins the app must reach.
 * @returns The `Content-Security-Policy` header value.
 */
export function cspHeader(sources: ConnectSources = {}): string {
  return serialise(cspDirectives(sources));
}

/**
 * The policy for a `<meta http-equiv>` tag. It is a second line of defence in
 * case a host is misconfigured; `frame-ancestors` only works as a header.
 *
 * @param sources - Extra origins the app must reach.
 * @returns The policy without header-only directives.
 */
export function cspMeta(sources: ConnectSources = {}): string {
  return serialise(
    [...cspDirectives(sources)].filter(
      ([name]) => !HEADER_ONLY_DIRECTIVES.has(name),
    ),
  );
}

/**
 * Every security header the frontend must be served with.
 *
 * @param sources - Extra origins the app must reach.
 * @returns Header names mapped to values.
 */
export function securityHeaders(
  sources: ConnectSources = {},
): Record<string, string> {
  return {
    "Content-Security-Policy": cspHeader(sources),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  };
}
