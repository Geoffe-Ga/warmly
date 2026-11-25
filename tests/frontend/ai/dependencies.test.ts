import { describe, expect, it } from "vitest";

/**
 * Who may import what in the AI layer (decision D-17, PRD SEC-009).
 *
 * The lint rule says the same thing; this test reads the source itself, so
 * the rule holds even if the lint configuration is changed.
 */
const SOURCES = import.meta.glob<string>("../../../src/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** The modules each source file imports, as written. */
function importsOf(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/g),
  ].map((match) => match[1] ?? match[2] ?? "");
}

function importers(pattern: RegExp): string[] {
  return Object.entries(SOURCES)
    .filter(([, source]) =>
      importsOf(source).some((name) => pattern.test(name)),
    )
    .map(([path]) => path.replace("../../../", ""))
    .sort();
}

describe("the AI layer's boundaries (D-17, SEC-009)", () => {
  it("reads the app's source", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(SOURCES["../../../src/ai/gateway.ts"]).toContain("class AiGateway");
  });

  it("only the gateway imports a provider", () => {
    expect(importers(/(^|\/)fake-provider$|\/ai\/providers\//)).toEqual([
      "src/ai/gateway.ts",
    ]);
  });

  it("only the gateway and the disclosure dialog import the consent module", () => {
    expect(importers(/(^|\/)consent$/)).toEqual([
      "src/ai/gateway.ts",
      "src/ui/components/AiDisclosureDialog.tsx",
    ]);
  });

  it("only the dialog makes a consent token, and only the gateway uses one up", () => {
    const using = (name: string): string[] =>
      Object.entries(SOURCES)
        .filter(
          ([path, source]) =>
            !path.endsWith("/ai/consent.ts") && source.includes(name),
        )
        .map(([path]) => path.replace("../../../", ""))
        .sort();

    expect(using("grantConsent")).toEqual([
      "src/ui/components/AiDisclosureDialog.tsx",
    ]);
    expect(using("consumeConsent")).toEqual(["src/ai/gateway.ts"]);
  });

  it("nothing in the AI layer reaches the network or the Warmly API", () => {
    const ai = Object.entries(SOURCES).filter(([path]) =>
      path.includes("/src/ai/"),
    );

    expect(ai.length).toBeGreaterThanOrEqual(4);
    for (const [path, source] of ai) {
      expect(source, path).not.toMatch(
        /\bfetch\(|XMLHttpRequest|WebSocket|api\/client/,
      );
    }
  });

  it("nothing calls the gateway on a timer or from storage or sync code", () => {
    const callers = importers(/\/ai\/gateway$/);

    for (const path of callers) {
      expect(path).not.toMatch(/^src\/(sync|storage|domain)\//);
    }
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.includes("/src/ai/")) {
        expect(source, path).not.toMatch(/setTimeout|setInterval/);
      }
    }
  });
});
