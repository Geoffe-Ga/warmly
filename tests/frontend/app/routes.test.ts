import { describe, expect, it } from "vitest";

import {
  PRIMARY_ACTIONS,
  ROUTES,
  SECONDARY_NAV,
  pathFor,
  type RouteId,
} from "../../../src/app/routes";

describe("route table", () => {
  it("covers every MVP screen exactly once", () => {
    expect(ROUTES.map((route) => route.id)).toEqual([
      "home",
      "journal",
      "journal-new",
      "journal-entry",
      "reflect",
      "reflect-session",
      "prepare",
      "collection",
      "card",
      "present",
      "print",
      "settings",
      "devices",
      "rotate-recovery-key",
      "onboarding",
      "verify-email",
      "recovery-key",
      "sign-in",
      "reset-password",
      "new-password",
      "recover",
      "trust-device",
      "locked",
    ]);
  });

  it("gives every route a unique path and a non-empty title", () => {
    const paths = ROUTES.map((route) => route.path);

    expect(new Set(paths).size).toBe(paths.length);
    for (const route of ROUTES) {
      expect(route.title.trim()).not.toBe("");
      expect(route.path.startsWith("/")).toBe(true);
    }
  });

  it("lists exactly the three primary Home actions, in PRD order (UX-001)", () => {
    expect(PRIMARY_ACTIONS.map((action) => action.label)).toEqual([
      "Journal",
      "Reflect",
      "Prepare for a Conversation",
    ]);
    expect(PRIMARY_ACTIONS.map((action) => action.path)).toEqual([
      "/journal",
      "/reflect",
      "/prepare",
    ]);
  });

  it("keeps collections, settings and devices in secondary navigation (UX-001)", () => {
    expect(SECONDARY_NAV.map((item) => item.label)).toEqual([
      "Collections",
      "Settings",
      "Manage Devices",
    ]);
  });
});

describe("pathFor", () => {
  it("returns a static path unchanged", () => {
    expect(pathFor("journal")).toBe("/journal");
  });

  it("substitutes opaque record IDs into a parameterised path", () => {
    expect(pathFor("card", { id: "c0ffee", cardId: "abc-123" })).toBe(
      "/prepare/collections/c0ffee/cards/abc-123",
    );
  });

  it("refuses a parameter that is not an opaque ID (SEC-007)", () => {
    expect(() => pathFor("journal-entry", { id: "my secret text" })).toThrow(
      /opaque/i,
    );
  });

  it("refuses an unknown route identifier", () => {
    expect(() => pathFor("nowhere" as RouteId)).toThrow(/unknown route/i);
  });

  it("refuses to build a path with a missing parameter", () => {
    expect(() => pathFor("journal-entry")).toThrow(/missing/i);
  });
});
