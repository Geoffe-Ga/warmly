import { describe, expect, it } from "vitest";

import {
  connectSourcesFromEnv,
  cspDirectives,
  cspHeader,
  cspMeta,
  securityHeaders,
} from "../../config/security-headers";

describe("Content Security Policy (SEC-007)", () => {
  it("denies everything by default and allows only same-origin code", () => {
    expect(cspHeader()).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; " +
        "img-src 'self'; font-src 'self'; manifest-src 'self'; " +
        "worker-src 'self'; connect-src 'self'; form-action 'self'; " +
        "base-uri 'none'; frame-ancestors 'none'",
    );
  });

  it("never allows inline code, eval or wildcards", () => {
    const policy = cspHeader({
      apiOrigin: "https://api.warmly.example",
      authOrigin: "https://auth.warmly.example",
    });

    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*|data:|blob:/);
  });

  it("adds only the configured origins to connect-src", () => {
    const directives = cspDirectives({
      apiOrigin: "https://api.warmly.example",
      authOrigin: "https://auth.warmly.example",
    });

    expect(directives.get("connect-src")).toEqual([
      "'self'",
      "https://api.warmly.example",
      "https://auth.warmly.example",
    ]);
  });

  it("lists no AI provider host; the AI gateway issue adds them explicitly", () => {
    expect(cspHeader()).not.toMatch(/openai|anthropic/);
  });

  it.each([
    "http://api.warmly.example",
    "https://api.warmly.example/v1",
    "https://*.warmly.example",
    "api.warmly.example",
    "'unsafe-inline'",
  ])("rejects %j as a connect source", (origin) => {
    expect(() => cspHeader({ apiOrigin: origin })).toThrow(/https origins/);
  });

  it("omits header-only directives from the meta-tag policy", () => {
    expect(cspMeta()).not.toContain("frame-ancestors");
    expect(cspMeta()).toContain("default-src 'none'");
    expect(`${cspMeta()}; frame-ancestors 'none'`).toBe(cspHeader());
  });
});

describe("securityHeaders", () => {
  it("includes the policy and the standard hardening headers", () => {
    expect(securityHeaders()).toEqual({
      "Content-Security-Policy": cspHeader(),
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    });
  });
});

describe("connect sources from the build environment", () => {
  it("allows nothing extra when nothing is configured", () => {
    expect(connectSourcesFromEnv({})).toEqual({});
    expect(
      connectSourcesFromEnv({ VITE_API_ORIGIN: "", VITE_SUPABASE_URL: "" }),
    ).toEqual({});
  });

  it("allows exactly the origin of the configured Supabase project", () => {
    const sources = connectSourcesFromEnv({
      VITE_SUPABASE_URL: "https://abcd.supabase.example/some/path?x=1",
      VITE_API_ORIGIN: "https://api.warmly.example",
    });

    expect(sources).toEqual({
      apiOrigin: "https://api.warmly.example",
      authOrigin: "https://abcd.supabase.example",
    });
    expect(cspDirectives(sources).get("connect-src")).toEqual([
      "'self'",
      "https://api.warmly.example",
      "https://abcd.supabase.example",
    ]);
  });

  it("refuses a production policy for a plain-http auth host", () => {
    const sources = connectSourcesFromEnv({
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    });

    expect(() => cspHeader(sources)).toThrow(/https origins/);
  });

  it("refuses a Supabase URL that is not a URL", () => {
    expect(() =>
      connectSourcesFromEnv({ VITE_SUPABASE_URL: "not a url" }),
    ).toThrow(TypeError);
  });
});
