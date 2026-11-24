import { describe, expect, it } from "vitest";

import { matchRoute, normalisePath } from "../../../src/app/router";

describe("normalisePath", () => {
  it.each([
    ["/", "/"],
    ["/journal/", "/journal"],
    ["/journal//", "/journal"],
    ["", "/"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normalisePath(input)).toBe(expected);
  });
});

describe("matchRoute", () => {
  it("matches the home route", () => {
    expect(matchRoute("/")?.route.id).toBe("home");
  });

  it("matches a static route with a trailing slash", () => {
    expect(matchRoute("/settings/devices/")?.route.id).toBe("devices");
  });

  it("prefers the static segment over a parameter", () => {
    expect(matchRoute("/journal/new")?.route.id).toBe("journal-new");
  });

  it("extracts opaque IDs as parameters", () => {
    const match = matchRoute("/prepare/collections/c1/cards/k2");

    expect(match?.route.id).toBe("card");
    expect(match?.params).toEqual({ id: "c1", cardId: "k2" });
  });

  it.each([
    "/nope",
    "/journal/entries",
    "/journal/entries/a/b",
    "/journal/entries/has%20space",
    "/journal/entries/" + "x".repeat(65),
  ])("returns undefined for %j", (path) => {
    expect(matchRoute(path)).toBeUndefined();
  });
});
