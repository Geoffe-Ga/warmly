import { describe, expect, it } from "vitest";

import { App } from "../../../src/app/App";
import { resolve } from "../../../src/app/resolve";
import { redirectFor } from "../../../src/app/access";
import { ROUTES, pathFor } from "../../../src/app/routes";

import { SAMPLE_PARAMS } from "./helpers";

describe("redirectFor", () => {
  it.each([
    ["public", "signed_out", undefined],
    ["public", "signed_in_locked", "/locked"],
    ["public", "unlocked", "/"],
    ["locked", "signed_out", "/sign-in"],
    ["locked", "signed_in_locked", undefined],
    ["locked", "unlocked", "/"],
    ["private", "signed_out", "/sign-in"],
    ["private", "signed_in_locked", "/locked"],
    ["private", "unlocked", undefined],
  ] as const)("%s screen while %s goes to %s", (access, state, expected) => {
    expect(redirectFor(access, state)).toBe(expected);
  });
});

describe("route guard (DEV-005, UI-008)", () => {
  const privateRoutes = ROUTES.filter((route) => route.access === "private");

  it("treats every screen that can show private content as private", () => {
    expect(
      ROUTES.filter((r) => r.access !== "private").map((r) => r.id),
    ).toEqual([
      "onboarding",
      "verify-email",
      "recovery-key",
      "sign-in",
      "reset-password",
      "new-password",
      "recover",
      "add-device",
      "device-revoked",
      "locked",
      "help",
    ]);
  });

  it("shows the one open screen, which is fixed words only, in every state", () => {
    expect(ROUTES.filter((r) => r.access === "open").map((r) => r.id)).toEqual([
      "help",
    ]);
    for (const state of [
      "signed_out",
      "signed_in_locked",
      "unlocked",
    ] as const) {
      expect(resolve("/help", state)).toMatchObject({ kind: "view" });
      expect(redirectFor("open", state)).toBeUndefined();
    }
  });

  it.each(privateRoutes.map((route) => [route.id, route] as const))(
    "never renders %s while signed out",
    (_id, route) => {
      expect(resolve(pathFor(route.id, SAMPLE_PARAMS), "signed_out")).toEqual({
        kind: "redirect",
        to: "/sign-in",
      });
    },
  );

  it.each(privateRoutes.map((route) => [route.id, route] as const))(
    "never renders %s while locked",
    (_id, route) => {
      expect(
        resolve(pathFor(route.id, SAMPLE_PARAMS), "signed_in_locked"),
      ).toEqual({ kind: "redirect", to: "/locked" });
    },
  );

  it.each(privateRoutes.map((route) => [route.id, route] as const))(
    "renders %s once unlocked",
    (_id, route) => {
      const resolution = resolve(pathFor(route.id, SAMPLE_PARAMS), "unlocked");

      expect(resolution.kind).toBe("view");
    },
  );

  it.each(["signed_out", "signed_in_locked", "unlocked"] as const)(
    "shows not-found for an unknown path while %s",
    (state) => {
      const resolution = resolve("/definitely/not/a/route", state);

      expect(resolution).toMatchObject({
        kind: "view",
        view: { title: "Page not found" },
      });
    },
  );

  it("resolves the component gallery outside production builds", () => {
    expect(resolve("/dev/components", "signed_out")).toMatchObject({
      kind: "view",
      view: { title: "Component gallery" },
    });
    expect(resolve("/dev/other", "signed_out")).toMatchObject({
      view: { title: "Page not found" },
    });
  });

  it("exports the root component", () => {
    expect(typeof App).toBe("function");
  });
});
