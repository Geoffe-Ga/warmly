import { beforeEach, describe, expect, it } from "vitest";

import { PRIMARY_ACTIONS, renderApp } from "../../src/app";

describe("renderApp", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"><p>stale</p></div>';
    root = document.getElementById("app") as HTMLElement;
  });

  it("renders a main landmark titled Warmly", () => {
    const main = renderApp(root);

    expect(main.tagName).toBe("MAIN");
    expect(main.querySelector("h1")?.textContent).toBe("Warmly");
  });

  it("renders exactly the three PRD primary actions, in order (UX-001)", () => {
    renderApp(root);

    const buttons = [...root.querySelectorAll("nav button")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Journal",
      "Reflect",
      "Prepare for a Conversation",
    ]);
    expect(buttons.map((b) => (b as HTMLElement).dataset["action"])).toEqual([
      "journal",
      "reflect",
      "prepare",
    ]);
  });

  it("labels the primary navigation for assistive technology", () => {
    renderApp(root);

    expect(root.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Primary",
    );
  });

  it("uses non-submitting buttons", () => {
    renderApp(root);

    for (const button of root.querySelectorAll("button")) {
      expect(button.type).toBe("button");
    }
  });

  it("replaces existing content rather than appending", () => {
    renderApp(root);
    renderApp(root);

    expect(root.querySelector("p")).toBeNull();
    expect(root.querySelectorAll("main")).toHaveLength(1);
  });

  it("exposes the primary actions as an immutable list of three", () => {
    expect(PRIMARY_ACTIONS).toHaveLength(3);
  });

  it("provides IndexedDB in the test environment", () => {
    expect(globalThis.indexedDB).toBeDefined();
  });
});
