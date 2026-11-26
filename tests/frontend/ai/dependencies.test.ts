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

  // Invariant 6: a reflection must be deleted when an entry it was built
  // from changes, and the engine that does it is issue #51. Until it
  // exists, no real provider may be connected, so that no real reflection
  // can exist. Issue #51 replaces this test with one for the engine.
  it("no real provider is connected before dependency invalidation exists (#51)", () => {
    const paths = Object.keys(SOURCES);
    const hasEngine = paths.some((path) => path.includes("/src/domain/deps/"));
    const realProviders = paths.filter((path) =>
      path.includes("/src/ai/providers/"),
    );
    const gateway = SOURCES["../../../src/ai/gateway.ts"] ?? "";

    expect(hasEngine || realProviders.length === 0).toBe(true);
    if (!hasEngine) {
      // The only provider the gateway can be made with is the stand-in.
      expect(gateway.match(/new \w*Provider\(/g)).toEqual([
        "new FakeProvider(",
      ]);
    }
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
      if (
        path.includes("/src/ai/") &&
        !path.endsWith("/ai/request-controller.ts")
      ) {
        expect(source, path).not.toMatch(/setTimeout|setInterval/);
      }
    }
  });

  it("the one timer in the AI code stops a request and can never send one", () => {
    const source = SOURCES["../../../src/ai/request-controller.ts"] ?? "";
    // Comments describe timers in words; only code is looked at.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toMatch(
      /setInterval|requestAnimationFrame|requestIdleCallback/,
    );
    expect(code.match(/setTimeout\(/g)).toHaveLength(1);
    // What the timer runs: stop the request that is waiting. Nothing else.
    expect(code).toMatch(
      /setTimeout\(\(\) => \{\s*this\.#stop\("timeout"\);\s*\}, this\.#timeoutMs\)/,
    );
    // The only place a request is sent is `confirm`, which needs consent.
    expect(code.match(/this\.#send\(/g)).toHaveLength(1);
    expect(code).toMatch(
      /async confirm\(consent: ConsentToken\)[\s\S]*this\.#send\(request, consent, abort\.signal\)/,
    );
    // `retry` only reopens the dialog.
    const retry = code.slice(
      code.indexOf("  retry(): void {"),
      code.indexOf("  reset(): void {"),
    );
    expect(retry).toContain('phase: "awaiting-consent"');
    expect(retry).not.toMatch(/#send|confirm\(/);
  });
});
